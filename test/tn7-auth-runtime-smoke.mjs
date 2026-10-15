import { createHmac } from 'node:crypto';

const api=(process.env.API_BASE || '').replace(/\/$/,'');
const web=(process.env.WEB_BASE || '').replace(/\/$/,'');
const secret=process.env.OPERATOR_JWT_SECRET || '';
const issuer=process.env.OPERATOR_JWT_ISSUER || '';
const audience=process.env.OPERATOR_JWT_AUDIENCE || '';

if(!api || !web || secret.length<32 || !issuer || !audience){
  throw new Error('runtime_smoke_configuration_missing');
}

function b64url(value){
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g,'')
    .replace(/\+/g,'-')
    .replace(/\//g,'_');
}

function token({sub,roles,expiresIn=300,iss=issuer,aud=audience}){
  const now=Math.floor(Date.now()/1000);
  const header=b64url(JSON.stringify({alg:'HS256',typ:'JWT'}));
  const payload=b64url(JSON.stringify({
    iss,aud,sub,roles,
    name:sub,
    iat:now-5,
    exp:now+expiresIn,
    jti:sub+'-'+now
  }));
  const signature=createHmac('sha256',secret)
    .update(header+'.'+payload)
    .digest('base64')
    .replace(/=/g,'')
    .replace(/\+/g,'-')
    .replace(/\//g,'_');
  return header+'.'+payload+'.'+signature;
}

async function request(base,path,{method='GET',bearer=null}={}){
  const headers={};
  if(bearer) headers.authorization='Bearer '+bearer;
  const response=await fetch(base+path,{method,headers});
  let body=null;
  const text=await response.text();
  try{ body=text?JSON.parse(text):null; }catch{ body=text; }
  return {status:response.status,body};
}

function assert(condition,label,detail=''){
  if(!condition) throw new Error('FAIL '+label+(detail?' '+detail:''));
  console.log('PASS '+label+(detail?' '+detail:''));
}

const reviewer=token({sub:'tn7-preview-reviewer',roles:['reviewer']});
const approver=token({sub:'tn7-preview-approver',roles:['approver']});
const admin=token({sub:'tn7-preview-admin',roles:['admin']});
const wrongIssuer=token({sub:'tn7-wrong-issuer',roles:['reviewer'],iss:'wrong-issuer'});

const before=await request(api,'/api/v1/network-inventory');
assert(before.status===200,'baseline inventory available');
const beforeCounts={
  ranks:before.body.ranks,
  associations:before.body.associations,
  routes:before.body.routes,
  rankAssociationCandidates:before.body.rank_association_candidates
};
console.log('TN7_AUTH_BEFORE '+JSON.stringify(beforeCounts));

const anonymousMe=await request(api,'/api/v1/operator/me');
assert(anonymousMe.status===401,'anonymous operator identity rejected');

const invalidMe=await request(api,'/api/v1/operator/me',{bearer:wrongIssuer});
assert(invalidMe.status===401,'wrong issuer rejected at runtime');

const reviewerMe=await request(api,'/api/v1/operator/me',{bearer:reviewer});
assert(reviewerMe.status===200,'reviewer identity accepted');
assert(reviewerMe.body.actor.subject==='tn7-preview-reviewer','reviewer subject returned');
assert(reviewerMe.body.mutationEnabled===false,'identity reports mutation disabled');
assert(reviewerMe.body.auth?.configured===true,'preview auth configured');
assert(!('secret' in (reviewerMe.body.auth || {})),'auth secret never returned');

const adminMe=await request(api,'/api/v1/operator/me',{bearer:admin});
assert(adminMe.status===200,'admin identity accepted');

const anonymousQueue=await request(api,'/api/v1/operator/quality-queue?limit=25');
assert(anonymousQueue.status===401,'anonymous quality queue rejected');

const queue=await request(api,'/api/v1/operator/quality-queue?limit=25',{bearer:reviewer});
assert(queue.status===200,'reviewer quality queue accepted');
assert(queue.body.mode==='operator_read_only','quality queue is read-only');
assert(queue.body.mutationEnabled===false,'quality queue mutations disabled');
assert(Array.isArray(queue.body.dataIssues),'quality queue returns detailed issues');
assert(Array.isArray(queue.body.rankAssociationCandidates),'quality queue returns association candidates');
assert(Array.isArray(queue.body.routeCandidatesWithoutAssociation),'quality queue returns unowned route candidates');
console.log('TN7_AUTH_QUEUE '+JSON.stringify({
  openIssues:queue.body.summary?.open_issues,
  issueRows:queue.body.dataIssues.length,
  rankAssociationCandidates:queue.body.rankAssociationCandidates.length,
  routeCandidatesWithoutAssociation:queue.body.routeCandidatesWithoutAssociation.length
}));

const anonymousIssues=await request(api,'/api/v1/data-issues?limit=5');
assert(anonymousIssues.status===401,'legacy detailed issue endpoint now requires auth');

const reviewerIssues=await request(api,'/api/v1/data-issues?limit=5',{bearer:reviewer});
assert(reviewerIssues.status===200,'reviewer may read detailed issues');

const anonymousRecon=await request(api,'/api/v1/reconciliation/rank-candidates');
assert(anonymousRecon.status===401,'legacy reconciliation queue now requires auth');

const reviewerRecon=await request(api,'/api/v1/reconciliation/rank-candidates?maxDistance=25',{bearer:reviewer});
assert(reviewerRecon.status===200,'reviewer may read reconciliation queue');

const reviewerMutation=await request(api,'/api/v1/operator/adjudications/test',{method:'POST',bearer:reviewer});
assert(reviewerMutation.status===403,'reviewer blocked from mutation boundary');

const anonymousMutation=await request(api,'/api/v1/operator/adjudications/test',{method:'POST'});
assert(anonymousMutation.status===401,'anonymous mutation rejected');

const approverMutation=await request(api,'/api/v1/operator/adjudications/test',{method:'POST',bearer:approver});
assert(approverMutation.status===501,'approver reaches dormant boundary only');
assert(approverMutation.body.mutationEnabled===false,'approver mutation remains disabled');

const webOperator=await request(web,'/api/v1/operator/me',{bearer:reviewer});
assert(webOperator.status===404,'public Web does not proxy operator identity');

const webIssues=await request(web,'/api/v1/data-issues',{bearer:reviewer});
assert(webIssues.status===404,'public Web does not proxy detailed issues');

const webMutation=await request(web,'/api/v1/operator/adjudications/test',{method:'POST',bearer:approver});
assert(webMutation.status===405,'public Web rejects operator POST');

const after=await request(api,'/api/v1/network-inventory');
assert(after.status===200,'post-auth inventory available');
const afterCounts={
  ranks:after.body.ranks,
  associations:after.body.associations,
  routes:after.body.routes,
  rankAssociationCandidates:after.body.rank_association_candidates
};
assert(JSON.stringify(afterCounts)===JSON.stringify(beforeCounts),'auth gate causes no canonical data count drift');
console.log('TN7_AUTH_AFTER '+JSON.stringify(afterCounts));

console.log('TN7_AUTH_RUNTIME_PASS');
await new Promise(resolve=>setTimeout(resolve,10000));
