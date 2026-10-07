import { createHmac } from 'node:crypto';
import pg from 'pg';

const { Pool }=pg;
const api=(process.env.API_BASE||'').replace(/\/$/,'');
const secret=process.env.OPERATOR_JWT_SECRET||'';
const issuer=process.env.OPERATOR_JWT_ISSUER||'';
const audience=process.env.OPERATOR_JWT_AUDIENCE||'';
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:false,max:2});

if(!api || secret.length<32 || !issuer || !audience || !process.env.DATABASE_URL){
  throw new Error('runtime_configuration_missing');
}

function b64(value){
  return Buffer.from(value).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
function token(sub,roles){
  const now=Math.floor(Date.now()/1000);
  const h=b64(JSON.stringify({alg:'HS256',typ:'JWT'}));
  const p=b64(JSON.stringify({iss:issuer,aud:audience,sub,roles,iat:now-5,exp:now+600,jti:sub+'-'+now}));
  const s=createHmac('sha256',secret).update(h+'.'+p).digest('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  return h+'.'+p+'.'+s;
}
async function call(path,{bearer=null,key=null,body=null}={}){
  const headers={'content-type':'application/json'};
  if(bearer) headers.authorization='Bearer '+bearer;
  if(key) headers['idempotency-key']=key;
  const response=await fetch(api+path,{method:'POST',headers,body:JSON.stringify(body||{})});
  const text=await response.text();
  let payload;
  try{payload=JSON.parse(text);}catch{payload=text;}
  return {status:response.status,payload};
}
function assert(ok,label,detail=''){
  if(!ok) throw new Error('FAIL '+label+(detail?' '+detail:''));
  console.log('PASS '+label+(detail?' '+detail:''));
}
async function issue(id){
  const r=await pool.query('SELECT id::text,status,resolved_at FROM data_issue WHERE id=$1::uuid',[id]);
  return r.rows[0];
}
async function audits(id){
  const r=await pool.query("SELECT id::text,actor_subject,actor_role,action,idempotency_key,rationale,before_state,after_state,evidence FROM operator_audit_event WHERE entity_id=$1::uuid ORDER BY occurred_at",[id]);
  return r.rows;
}

const reviewer=token('adj1-reviewer',['reviewer']);
const approver=token('adj1-approver',['approver']);
const admin=token('adj1-admin',['admin']);

const i1='11111111-1111-4111-8111-111111111111';
const i2='22222222-2222-4222-8222-222222222222';
const i3='33333333-3333-4333-8333-333333333333';
const i4='44444444-4444-4444-8444-444444444444';
const path=id=>'/api/v1/operator/adjudications/data-issues/'+id+'/defer';

assert((await call(path(i1),{body:{rationale:'A valid deferral rationale',expectedStatus:'open'}})).status===401,'anonymous defer rejected');
assert((await call(path(i1),{bearer:reviewer,key:'adj1-reviewer-denied',body:{rationale:'A valid deferral rationale',expectedStatus:'open'}})).status===403,'reviewer defer rejected');
assert((await call(path(i1),{bearer:approver,body:{rationale:'A valid deferral rationale',expectedStatus:'open'}})).status===400,'missing idempotency key rejected');
assert((await call(path(i1),{bearer:approver,key:'adj1-short-rationale',body:{rationale:'short',expectedStatus:'open'}})).status===400,'short rationale rejected');
assert((await call(path(i1),{bearer:approver,key:'adj1-missing-status',body:{rationale:'A valid deferral rationale'}})).status===400,'missing expected status rejected');

const first=await call(path(i1),{
  bearer:approver,
  key:'adj1-issue-one',
  body:{rationale:'Await authoritative field verification before resolution.',expectedStatus:'open',evidence:{source:'field-review-pending'}}
});
assert(first.status===200 && first.payload.replay===false,'approver defer succeeds');
assert(first.payload.issue?.status==='deferred','issue returned deferred');
assert((await issue(i1)).status==='deferred','database issue deferred');
let a1=await audits(i1);
assert(a1.length===1,'one audit event written');
assert(a1[0].actor_subject==='adj1-approver' && a1[0].actor_role==='approver','audit actor authoritative');
assert(a1[0].action==='data_issue.defer','audit action correct');
assert(a1[0].before_state.status==='open' && a1[0].after_state.status==='deferred','audit before/after preserved');
assert(a1[0].rationale.includes('authoritative field verification'),'audit rationale preserved');

const replay=await call(path(i1),{
  bearer:approver,
  key:'adj1-issue-one',
  body:{rationale:'Await authoritative field verification before resolution.',expectedStatus:'open'}
});
assert(replay.status===200 && replay.payload.replay===true,'same idempotency key replays safely');
assert((await audits(i1)).length===1,'replay does not duplicate audit');

const stale=await call(path(i1),{
  bearer:approver,
  key:'adj1-issue-one-different',
  body:{rationale:'Second decision should not overwrite deferred state.',expectedStatus:'open'}
});
assert(stale.status===409 && stale.payload.currentStatus==='deferred','stale expected status rejected');
assert((await audits(i1)).length===1,'stale request writes no audit');

const adminResult=await call(path(i2),{
  bearer:admin,
  key:'adj1-issue-two',
  body:{rationale:'Defer reviewing issue pending additional documentary evidence.',expectedStatus:'reviewing'}
});
assert(adminResult.status===200 && adminResult.payload.replay===false,'admin can defer reviewing issue');
assert((await issue(i2)).status==='deferred','reviewing issue moved to deferred');
assert((await audits(i2)).length===1,'admin defer audited once');

const concurrentBody={rationale:'Concurrent duplicate request proof for idempotent adjudication.',expectedStatus:'open'};
const concurrent=await Promise.all([
  call(path(i4),{bearer:approver,key:'adj1-concurrent-one',body:concurrentBody}),
  call(path(i4),{bearer:approver,key:'adj1-concurrent-one',body:concurrentBody})
]);
assert(concurrent.every(x=>x.status===200),'concurrent duplicate requests both return success');
assert(concurrent.filter(x=>x.payload.replay===false).length===1,'exactly one concurrent request mutates');
assert(concurrent.filter(x=>x.payload.replay===true).length===1,'exactly one concurrent request replays');
assert((await audits(i4)).length===1,'concurrent duplicate creates one audit row');
assert((await issue(i4)).status==='deferred','concurrent target deferred once');

const auditId=(await audits(i1))[0].id;
let updateBlocked=false;
try{await pool.query("UPDATE operator_audit_event SET rationale='tamper' WHERE id=$1::uuid",[auditId]);}catch(e){updateBlocked=String(e.message).includes('append-only');}
assert(updateBlocked,'audit update blocked by trigger');
let deleteBlocked=false;
try{await pool.query('DELETE FROM operator_audit_event WHERE id=$1::uuid',[auditId]);}catch(e){deleteBlocked=String(e.message).includes('append-only');}
assert(deleteBlocked,'audit delete blocked by trigger');

await pool.query("ALTER TABLE operator_audit_event ADD CONSTRAINT tn7_adj1_force_audit_failure CHECK (action <> 'data_issue.defer') NOT VALID");
const atomic=await call(path(i3),{
  bearer:approver,
  key:'adj1-atomic-failure',
  body:{rationale:'Force audit insert failure to prove transaction rollback.',expectedStatus:'open'}
});
assert(atomic.status===500,'audit write failure returns server error');
assert((await issue(i3)).status==='open','issue mutation rolled back when audit insert fails');
assert((await audits(i3)).length===0,'failed transaction leaves no audit row');
console.log('TN7_ADJ1_ATOMIC_ROLLBACK_PASS');

const counts=await pool.query("SELECT status,count(*)::int AS count FROM data_issue GROUP BY status ORDER BY status");
console.log('TN7_ADJ1_FINAL '+JSON.stringify(counts.rows));
console.log('TN7_ADJ1_RUNTIME_PASS');

await pool.end();
await new Promise(resolve=>setTimeout(resolve,10000));
