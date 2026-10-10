import { createHmac } from 'node:crypto';

const base=(process.env.WORKBENCH_BASE||'').replace(/\/$/,'');
const publicWeb=(process.env.PUBLIC_WEB_BASE||'').replace(/\/$/,'');
const secret=process.env.OPERATOR_JWT_SECRET||'';
const issuer=process.env.OPERATOR_JWT_ISSUER||'tenderize-iam';
const audience=process.env.OPERATOR_JWT_AUDIENCE||'transport-network-operator';
if(!base || !publicWeb || secret.length<32) throw new Error('runtime_configuration_missing');

function b64(v){return Buffer.from(v).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');}
function token(sub,roles){
  const now=Math.floor(Date.now()/1000);
  const h=b64(JSON.stringify({alg:'HS256',typ:'JWT'}));
  const p=b64(JSON.stringify({iss:issuer,aud:audience,sub,roles,iat:now-5,exp:now+1200,name:sub}));
  const s=createHmac('sha256',secret).update(h+'.'+p).digest('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  return h+'.'+p+'.'+s;
}
async function call(path,{method='GET',bearer=null,key=null,body=null,root=false}={}){
  const headers={};
  if(bearer) headers.authorization='Bearer '+bearer;
  if(key) headers['idempotency-key']=key;
  if(body!==null) headers['content-type']='application/json';
  const url=(root?base:base+'/operator-api')+path;
  const r=await fetch(url,{method,headers,body:body===null?undefined:JSON.stringify(body)});
  const text=await r.text();let payload;try{payload=text?JSON.parse(text):null}catch{payload=text}
  return {status:r.status,payload,text};
}
function assert(ok,label){if(!ok) throw new Error('FAIL '+label);console.log('PASS '+label);}

const reviewer=token('adj9-reviewer',['reviewer']);
const approver=token('adj9-approver',['approver']);
const admin=token('adj9-admin',['admin']);

const home=await fetch(base+'/');
assert(home.status===200,'private operator workbench UI loads when explicitly enabled');

let w=await call('/api/v1/operator/workbench?limit=120');
assert(w.status===401,'anonymous workbench API access rejected');

w=await call('/api/v1/operator/workbench?limit=120',{bearer:reviewer});
assert(w.status===200 && w.payload.mode==='operator_workbench','reviewer can load authenticated workbench');
assert(Array.isArray(w.payload.actionCatalog) && w.payload.actionCatalog.length===9,'ADJ1-ADJ8 action catalogue unified');
assert(w.payload.actionCatalog.every(a=>a.enabled===true),'all isolated acceptance action switches visible as enabled');
assert(Array.isArray(w.payload.queues.dataIssues) && Array.isArray(w.payload.proposals.pending) && Array.isArray(w.payload.audit.recent),'queues proposals and audit surfaced together');

// ADJ1 direct issue action through workbench proxy.
const issueId='cccccccc-0001-4001-8001-000000000001';
let defer=await call('/api/v1/operator/adjudications/data-issues/'+issueId+'/defer',{
  method:'POST',bearer:reviewer,key:'adj9-reviewer-defer',
  body:{rationale:'Reviewer must not execute direct defer action.',expectedStatus:'open',evidence:{workbench:true}}
});
assert(defer.status===403,'reviewer cannot execute approver-only direct issue action');

defer=await call('/api/v1/operator/adjudications/data-issues/'+issueId+'/defer',{
  method:'POST',bearer:approver,key:'adj9-approver-defer',
  body:{rationale:'Defer issue after reviewing evidence in integrated workbench.',expectedStatus:'open',evidence:{workbench:true}}
});
assert(defer.status===200,'approver executes ADJ1 defer through workbench proxy');

w=await call('/api/v1/operator/workbench?limit=120',{bearer:approver});
assert(w.status===200 && w.payload.queues.dataIssues.some(i=>i.id===issueId && i.status==='deferred'),'workbench immediately reflects deferred issue state');
const deferAudit=w.payload.audit.recent.find(a=>a.entityId===issueId && a.action==='data_issue.defer');
assert(Boolean(deferAudit),'workbench exposes canonical defer audit');

// ADJ2 reopen through same integrated surface.
const reopen=await call('/api/v1/operator/adjudications/data-issues/'+issueId+'/reopen',{
  method:'POST',bearer:admin,key:'adj9-admin-reopen',
  body:{
    rationale:'Reopen deferred issue after follow-up review in workbench.',
    expectedStatus:'deferred',
    priorAuditEventId:deferAudit.id,
    evidence:{workbench:true}
  }
});
assert(reopen.status===200,'admin executes ADJ2 reopen through workbench proxy');

w=await call('/api/v1/operator/workbench?limit=120',{bearer:admin});
assert(w.payload.queues.dataIssues.some(i=>i.id===issueId && i.status==='open'),'workbench reflects reopened issue state');

// ADJ4 proposal creation and rejection through private proxy.
const rankId='10101010-1010-4010-8010-101010101010';
const aliasCreate=await call('/api/v1/operator/proposals/ranks/'+rankId+'/aliases',{
  method:'POST',bearer:reviewer,key:'adj9-rank-alias-create',
  body:{alias:'ADJ9 Integrated Rank Alias',rationale:'Propose a controlled rank alias from integrated workbench.',evidence:{workbench:true}}
});
assert(aliasCreate.status===201,'ADJ4 alias proposal created through workbench proxy');
const aliasPid=aliasCreate.payload.proposal.id;

w=await call('/api/v1/operator/workbench?limit=120',{bearer:approver});
assert(w.payload.proposals.pending.some(p=>p.id===aliasPid && p.action==='taxi_rank.alias.add'),'new alias proposal appears in pending decision queue');

const rejectAlias=await call('/api/v1/operator/proposals/'+aliasPid+'/reject',{
  method:'POST',bearer:approver,key:'adj9-rank-alias-reject',
  body:{rationale:'Reject alias proposal as controlled operator acceptance proof.',evidence:{workbench:true}}
});
assert(rejectAlias.status===200,'ADJ4 proposal rejected from integrated decision queue');

// ADJ8 proposal/approval exercises the generic two-person approval path.
const survivor='aaaaaaaa-0010-4010-8010-000000000010';
const duplicate='aaaaaaaa-0011-4011-8011-000000000011';
const mergeCreate=await call('/api/v1/operator/proposals/association-merges',{
  method:'POST',bearer:reviewer,key:'adj9-association-merge-create',
  body:{
    survivorAssociationId:survivor,
    duplicateAssociationId:duplicate,
    rationale:'Propose duplicate association merge from integrated workbench.',
    evidence:{workbench:true}
  }
});
assert(mergeCreate.status===201,'ADJ8 association merge proposal created through workbench proxy');
const mergePid=mergeCreate.payload.proposal.id;

const selfApprove=await call('/api/v1/operator/proposals/'+mergePid+'/approve',{
  method:'POST',bearer:reviewer,key:'adj9-reviewer-self-approve',
  body:{rationale:'Reviewer self approval must be denied.',evidence:{workbench:true}}
});
assert(selfApprove.status===403,'two-person boundary enforced through workbench');

w=await call('/api/v1/operator/workbench?limit=120',{bearer:approver});
assert(w.payload.proposals.pending.some(p=>p.id===mergePid),'approver sees pending association merge proposal');

const approve=await call('/api/v1/operator/proposals/'+mergePid+'/approve',{
  method:'POST',bearer:approver,key:'adj9-association-merge-approve',
  body:{rationale:'Independent approver accepts merge after reviewing integrated evidence.',evidence:{workbench:true}}
});
assert(approve.status===200,'independent approver executes proposal from workbench');

w=await call('/api/v1/operator/workbench?limit=120',{bearer:approver});
assert(!w.payload.proposals.pending.some(p=>p.id===mergePid),'approved proposal leaves pending queue');
assert(w.payload.proposals.recent.some(p=>p.id===mergePid && p.status==='approved'),'approved proposal remains visible in recent decisions');

const actions=w.payload.audit.recent.map(a=>a.action);
assert(actions.includes('decision_proposal.create'),'proposal creation audit visible');
assert(actions.includes('taxi_association.merge'),'canonical merge audit visible');
assert(actions.includes('decision_proposal.approve'),'proposal approval audit visible');
assert(actions.includes('data_issue.defer') && actions.includes('data_issue.reopen'),'direct action audit trail visible');

// Public map boundary must still hide the operator workbench.
const publicResponse=await fetch(publicWeb+'/api/v1/operator/workbench',{headers:{authorization:'Bearer '+reviewer}});
assert(publicResponse.status===404,'public Web does not proxy operator workbench');

console.log('TN7_ADJ9_OPERATOR_FLOW_PASS');
console.log('TN7_ADJ9_RUNTIME_PASS');
await new Promise(r=>setTimeout(r,5000));
