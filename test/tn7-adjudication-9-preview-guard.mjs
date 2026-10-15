import { createHmac } from 'node:crypto';

const api=(process.env.API_BASE||'').replace(/\/$/,'');
const web=(process.env.WEB_BASE||'').replace(/\/$/,'');
const secret=process.env.OPERATOR_JWT_SECRET||'';
const issuer=process.env.OPERATOR_JWT_ISSUER||'';
const audience=process.env.OPERATOR_JWT_AUDIENCE||'';
if(!api || !web || secret.length<32 || !issuer || !audience) throw new Error('preview_guard_configuration_missing');

function b64(v){return Buffer.from(v).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');}
function token(sub,roles){
  const now=Math.floor(Date.now()/1000);
  const h=b64(JSON.stringify({alg:'HS256',typ:'JWT'}));
  const p=b64(JSON.stringify({iss:issuer,aud:audience,sub,roles,iat:now-5,exp:now+300}));
  const s=createHmac('sha256',secret).update(h+'.'+p).digest('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  return h+'.'+p+'.'+s;
}
async function request(base,path,{method='GET',bearer=null,key=null,body=null}={}){
  const headers={};
  if(bearer) headers.authorization='Bearer '+bearer;
  if(key) headers['idempotency-key']=key;
  if(body!==null) headers['content-type']='application/json';
  const r=await fetch(base+path,{method,headers,body:body===null?undefined:JSON.stringify(body)});
  const text=await r.text();let payload;try{payload=text?JSON.parse(text):null}catch{payload=text}
  return {status:r.status,payload};
}
function assert(ok,label){if(!ok) throw new Error('FAIL '+label);console.log('PASS '+label);}

const before=await request(api,'/api/v1/network-inventory');
assert(before.status===200,'preview inventory before guard available');
const keys=['ranks','associations','routes','rank_association_candidates'];

const approver=token('tn7-adj9-preview-approver',['approver']);
const reviewer=token('tn7-adj9-preview-reviewer',['reviewer']);

const workbench=await request(api,'/api/v1/operator/workbench?limit=20',{bearer:approver});
assert(workbench.status===503 &&
  workbench.payload?.error==='operator_workbench_schema_unavailable' &&
  workbench.payload?.mutationEnabled===false,
  'normal preview workbench fails closed without adjudication schema');

const me=await request(api,'/api/v1/operator/me',{bearer:approver});
assert(me.status===200 && me.payload?.mutationEnabled===false,'normal preview mutation capability disabled');
const adj=me.payload?.auth?.adjudication||{};
assert((adj.enabledActions||[]).length===0,'normal preview has zero enabled adjudication actions');
assert(adj.dualControlEnabled===false &&
  adj.aliasPromotionEnabled===false &&
  adj.associationAssignmentEnabled===false &&
  adj.routePromotionEnabled===false &&
  adj.rankMergeEnabled===false &&
  adj.associationMergeEnabled===false,
  'normal preview dual-control mutations remain disabled');

const merge=await request(api,'/api/v1/operator/proposals/association-merges',{
  method:'POST',bearer:reviewer,key:'adj9-preview-merge',
  body:{
    survivorAssociationId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    duplicateAssociationId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    rationale:'Preview guard keeps association merge disabled.',
    evidence:{guard:true}
  }
});
assert(merge.status===503 && merge.payload?.error==='association_merge_disabled','normal preview merge mutation fails closed');

const publicWorkbench=await request(web,'/api/v1/operator/workbench',{bearer:approver});
assert(publicWorkbench.status===404,'public Web does not expose operator workbench');

const publicPost=await request(web,'/api/v1/operator/proposals/association-merges',{
  method:'POST',bearer:reviewer,key:'adj9-web-post',
  body:{}
});
assert(publicPost.status===405,'public Web still blocks operator mutation POST');

const ranks=await request(api,'/api/v1/ranks');
const associations=await request(api,'/api/v1/associations');
assert(ranks.status===200,'normal preview rank feed healthy');
assert(associations.status===200,'normal preview association feed healthy');

const after=await request(api,'/api/v1/network-inventory');
assert(after.status===200,'preview inventory after guard available');
for(const key of keys) assert(before.payload[key]===after.payload[key],'preview count unchanged '+key);

console.log('TN7_ADJ9_PREVIEW_COUNTS '+JSON.stringify(Object.fromEntries(keys.map(k=>[k,after.payload[k]]))));
console.log('TN7_ADJ9_PREVIEW_GUARD_PASS');
await new Promise(r=>setTimeout(r,5000));
