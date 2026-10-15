import { createHmac } from 'node:crypto';

const api=(process.env.API_BASE||'').replace(/\/$/,'');
const web=(process.env.WEB_BASE||'').replace(/\/$/,'');
const secret=process.env.OPERATOR_JWT_SECRET||'';
const issuer=process.env.OPERATOR_JWT_ISSUER||'';
const audience=process.env.OPERATOR_JWT_AUDIENCE||'';

if(!api || !web || secret.length<32 || !issuer || !audience){
  throw new Error('preview_guard_configuration_missing');
}

function b64(value){
  return Buffer.from(value).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
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
  const response=await fetch(base+path,{method,headers,body:body===null?undefined:JSON.stringify(body)});
  const text=await response.text();
  let payload;
  try{payload=text?JSON.parse(text):null;}catch{payload=text;}
  return {status:response.status,payload};
}
function assert(ok,label){if(!ok) throw new Error('FAIL '+label);console.log('PASS '+label);}

const before=await request(api,'/api/v1/network-inventory');
assert(before.status===200,'preview inventory before guard available');
const keys=['ranks','associations','routes','rank_association_candidates'];

const reviewer=token('tn7-adj8-preview-reviewer',['reviewer']);
const approver=token('tn7-adj8-preview-approver',['approver']);
const create=await request(api,'/api/v1/operator/proposals/association-merges',{
  method:'POST',
  bearer:reviewer,
  key:'tn7-adj8-preview-create',
  body:{
    survivorAssociationId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    duplicateAssociationId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    rationale:'Preview guard must keep canonical association merge disabled.',
    evidence:{guard:true}
  }
});
assert(create.status===503 && create.payload?.error==='association_merge_disabled' && create.payload?.mutationEnabled===false,'preview association merge disabled');

const approve=await request(api,'/api/v1/operator/proposals/cccccccc-cccc-4ccc-8ccc-cccccccccccc/approve',{
  method:'POST',
  bearer:approver,
  key:'tn7-adj8-preview-approve',
  body:{rationale:'Preview guard must keep proposal approval disabled.',evidence:{guard:true}}
});
assert(approve.status===503 && approve.payload?.error==='dual_control_disabled' && approve.payload?.mutationEnabled===false,'preview proposal approval disabled');

const me=await request(api,'/api/v1/operator/me',{bearer:approver});
assert(me.status===200 && me.payload?.mutationEnabled===false,'preview mutation capability disabled');
const adj=me.payload?.auth?.adjudication || {};
assert(adj.dualControlEnabled===false && adj.associationMergeEnabled===false && (adj.enabledActions||[]).length===0,'preview association merge capability absent');

const webPost=await request(web,'/api/v1/operator/proposals/association-merges',{
  method:'POST',
  bearer:reviewer,
  key:'tn7-adj8-web-post',
  body:{
    survivorAssociationId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    duplicateAssociationId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    rationale:'Public Web must reject association merge mutations.',
    evidence:{guard:true}
  }
});
assert(webPost.status===405,'public Web association merge POST blocked');

const webGet=await request(web,'/api/v1/operator/proposals/cccccccc-cccc-4ccc-8ccc-cccccccccccc',{bearer:reviewer});
assert(webGet.status===404,'public Web proposal GET blocked');

const associations=await request(api,'/api/v1/associations');
assert(associations.status===200,'preview association feed remains healthy');

const after=await request(api,'/api/v1/network-inventory');
assert(after.status===200,'preview inventory after guard available');
for(const key of keys) assert(before.payload[key]===after.payload[key],'preview count unchanged '+key);

console.log('TN7_ADJ8_PREVIEW_COUNTS '+JSON.stringify(Object.fromEntries(keys.map(k=>[k,after.payload[k]]))));
console.log('TN7_ADJ8_PREVIEW_GUARD_PASS');
await new Promise(resolve=>setTimeout(resolve,5000));
