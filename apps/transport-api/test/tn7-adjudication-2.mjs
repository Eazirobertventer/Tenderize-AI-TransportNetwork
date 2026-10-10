import { createHmac } from 'node:crypto';
import pg from 'pg';

const { Pool }=pg;
const api=(process.env.API_BASE||'').replace(/\/$/,'');
const secret=process.env.OPERATOR_JWT_SECRET||'';
const issuer=process.env.OPERATOR_JWT_ISSUER||'';
const audience=process.env.OPERATOR_JWT_AUDIENCE||'';
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:false,max:3});

if(!api || secret.length<32 || !issuer || !audience || !process.env.DATABASE_URL){
  throw new Error('runtime_configuration_missing');
}

function b64(value){
  return Buffer.from(value).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
function token(sub,roles){
  const now=Math.floor(Date.now()/1000);
  const h=b64(JSON.stringify({alg:'HS256',typ:'JWT'}));
  const p=b64(JSON.stringify({iss:issuer,aud:audience,sub,roles,iat:now-5,exp:now+900,jti:sub+'-'+now}));
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
  try{ payload=JSON.parse(text); }catch{ payload=text; }
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
async function audits(id,action=null){
  const params=[id];
  let where="entity_id=$1::uuid";
  if(action){ params.push(action); where+=" AND action=$2"; }
  const r=await pool.query(
    `SELECT id::text,event_sequence,actor_subject,actor_role,action,idempotency_key,rationale,before_state,after_state,evidence,metadata
     FROM operator_audit_event
     WHERE ${where}
     ORDER BY event_sequence`,
    params
  );
  return r.rows;
}

const reviewer=token('adj2-reviewer',['reviewer']);
const approver=token('adj2-approver',['approver']);
const admin=token('adj2-admin',['admin']);

const rejectId='55555555-5555-4555-8555-555555555555';
const deferReopenId='66666666-6666-4666-8666-666666666666';
const latestId='77777777-7777-4777-8777-777777777777';
const rejectAtomicId='88888888-8888-4888-8888-888888888888';
const reopenAtomicId='99999999-9999-4999-8999-999999999999';
const rejectPath=id=>'/api/v1/operator/adjudications/data-issues/'+id+'/reject';
const deferPath=id=>'/api/v1/operator/adjudications/data-issues/'+id+'/defer';
const reopenPath=id=>'/api/v1/operator/adjudications/data-issues/'+id+'/reopen';

// Reject boundary and validation.
assert((await call(rejectPath(rejectId),{
  body:{rationale:'Reject proof rationale is sufficiently descriptive.',expectedStatus:'open',evidence:{source:'proof'}}
})).status===401,'anonymous reject rejected');

assert((await call(rejectPath(rejectId),{
  bearer:reviewer,key:'adj2-reviewer-reject',body:{rationale:'Reviewer must not reject this issue.',expectedStatus:'open',evidence:{source:'proof'}}
})).status===403,'reviewer reject rejected');

assert((await call(rejectPath(rejectId),{
  bearer:approver,key:'adj2-no-evidence',body:{rationale:'Reject requires evidence as well as rationale.',expectedStatus:'open'}
})).status===400,'reject without evidence rejected');

// Reject open -> rejected.
const reject1=await call(rejectPath(rejectId),{
  bearer:approver,
  key:'adj2-reject-one',
  body:{
    rationale:'Source evidence shows this issue is not a valid canonical defect.',
    expectedStatus:'open',
    evidence:{source:'source-review',decision:'not-a-defect'}
  }
});
assert(reject1.status===200 && reject1.payload.replay===false,'approver reject succeeds');
const rejected=await issue(rejectId);
assert(rejected.status==='rejected','issue moved to rejected');
assert(rejected.resolved_at!==null,'rejected issue gets resolved timestamp');

let rejectAudits=await audits(rejectId,'data_issue.reject');
assert(rejectAudits.length===1,'reject writes exactly one audit event');
const rejectAudit=rejectAudits[0];
assert(rejectAudit.before_state.status==='open' && rejectAudit.after_state.status==='rejected','reject before/after preserved');
assert(rejectAudit.evidence.decision==='not-a-defect','reject evidence preserved');

// Reject replay.
const rejectReplay=await call(rejectPath(rejectId),{
  bearer:approver,
  key:'adj2-reject-one',
  body:{rationale:'Source evidence shows this issue is not a valid canonical defect.',expectedStatus:'open',evidence:{source:'source-review',decision:'not-a-defect'}}
});
assert(rejectReplay.status===200 && rejectReplay.payload.replay===true,'reject replay is idempotent');
assert((await audits(rejectId,'data_issue.reject')).length===1,'reject replay adds no audit row');

// Reopen rejected -> exact prior state.
assert((await call(reopenPath(rejectId),{
  bearer:approver,
  key:'adj2-reopen-missing-prior',
  body:{rationale:'Reopen requires explicit audit lineage.',expectedStatus:'rejected'}
})).status===400,'reopen without prior audit rejected');

const reopenReject=await call(reopenPath(rejectId),{
  bearer:admin,
  key:'adj2-reopen-reject',
  body:{
    rationale:'New evidence requires the rejected issue to return to active review.',
    expectedStatus:'rejected',
    priorAuditEventId:rejectAudit.id,
    evidence:{source:'new-authoritative-evidence'}
  }
});
assert(reopenReject.status===200 && reopenReject.payload.replay===false,'admin reopens rejected issue');
assert(reopenReject.payload.restoredStatus==='open','rejected issue restores prior open state');
const reopenedReject=await issue(rejectId);
assert(reopenedReject.status==='open' && reopenedReject.resolved_at===null,'reopened rejected issue active again');

let reopenAudits=await audits(rejectId,'data_issue.reopen');
assert(reopenAudits.length===1,'reopen writes audit event');
assert(reopenAudits[0].metadata.reversesAuditEventId===rejectAudit.id,'reopen audit references reversed reject event');
assert(reopenAudits[0].before_state.status==='rejected' && reopenAudits[0].after_state.status==='open','reopen before/after preserved');

// Defer reviewing -> reopen exactly to reviewing, with concurrent replay.
const defer=await call(deferPath(deferReopenId),{
  bearer:approver,
  key:'adj2-defer-reviewing',
  body:{rationale:'Temporarily defer while additional route documentation is collected.',expectedStatus:'reviewing',evidence:{source:'pending-documents'}}
});
assert(defer.status===200 && defer.payload.issue.status==='deferred','reviewing issue deferred');
const deferAuditId=defer.payload.auditEventId;

const reopenBody={
  rationale:'Required documentation arrived; restore the issue to its prior reviewing state.',
  expectedStatus:'deferred',
  priorAuditEventId:deferAuditId,
  evidence:{source:'documents-received'}
};
const concurrent=await Promise.all([
  call(reopenPath(deferReopenId),{bearer:approver,key:'adj2-concurrent-reopen',body:reopenBody}),
  call(reopenPath(deferReopenId),{bearer:approver,key:'adj2-concurrent-reopen',body:reopenBody})
]);
assert(concurrent.every(x=>x.status===200),'concurrent reopen requests both succeed safely');
assert(concurrent.filter(x=>x.payload.replay===false).length===1,'exactly one concurrent reopen mutates');
assert(concurrent.filter(x=>x.payload.replay===true).length===1,'exactly one concurrent reopen replays');
assert((await issue(deferReopenId)).status==='reviewing','undefer restores reviewing state exactly');
assert((await audits(deferReopenId,'data_issue.reopen')).length===1,'concurrent reopen creates one audit row');

// Superseded audit reference must fail.
const firstReject=await call(rejectPath(latestId),{
  bearer:approver,key:'adj2-latest-reject-1',
  body:{rationale:'First reject decision for latest-audit lineage proof.',expectedStatus:'open',evidence:{iteration:1}}
});
assert(firstReject.status===200,'first reject for lineage proof succeeds');

const firstReopen=await call(reopenPath(latestId),{
  bearer:approver,key:'adj2-latest-reopen-1',
  body:{rationale:'First reject is reversed by later evidence.',expectedStatus:'rejected',priorAuditEventId:firstReject.payload.auditEventId,evidence:{iteration:2}}
});
assert(firstReopen.status===200 && firstReopen.payload.restoredStatus==='open','first reject reverses to open');

const secondReject=await call(rejectPath(latestId),{
  bearer:approver,key:'adj2-latest-reject-2',
  body:{rationale:'Second reject supersedes the prior reversed reject event.',expectedStatus:'open',evidence:{iteration:3}}
});
assert(secondReject.status===200,'second reject succeeds');

const stalePrior=await call(reopenPath(latestId),{
  bearer:approver,key:'adj2-stale-prior-reopen',
  body:{rationale:'Older reject event must not be reversible after a newer decision.',expectedStatus:'rejected',priorAuditEventId:firstReject.payload.auditEventId,evidence:{iteration:4}}
});
assert(stalePrior.status===409 && stalePrior.payload.error==='prior_adjudication_not_latest','superseded audit reference rejected');
assert((await issue(latestId)).status==='rejected','stale reversal leaves latest rejected state unchanged');

const validLatest=await call(reopenPath(latestId),{
  bearer:approver,key:'adj2-latest-reopen-2',
  body:{rationale:'Reverse the actual latest reject event and restore prior state.',expectedStatus:'rejected',priorAuditEventId:secondReject.payload.auditEventId,evidence:{iteration:5}}
});
assert(validLatest.status===200 && validLatest.payload.restoredStatus==='open','latest reject event can be reversed');

// Reject atomic rollback.
await pool.query("ALTER TABLE operator_audit_event ADD CONSTRAINT tn7_adj2_force_reject_audit_failure CHECK (action <> 'data_issue.reject') NOT VALID");
const rejectAtomic=await call(rejectPath(rejectAtomicId),{
  bearer:approver,key:'adj2-reject-atomic',
  body:{rationale:'Force reject audit failure to prove atomic rollback.',expectedStatus:'open',evidence:{proof:'reject-rollback'}}
});
assert(rejectAtomic.status===500,'forced reject audit failure returns server error');
assert((await issue(rejectAtomicId)).status==='open','reject mutation rolled back on audit failure');
assert((await audits(rejectAtomicId)).length===0,'reject audit failure leaves no audit row');
await pool.query('ALTER TABLE operator_audit_event DROP CONSTRAINT tn7_adj2_force_reject_audit_failure');
console.log('TN7_ADJ2_REJECT_ATOMIC_ROLLBACK_PASS');

// Reopen atomic rollback.
const atomicDefer=await call(deferPath(reopenAtomicId),{
  bearer:approver,key:'adj2-reopen-atomic-defer',
  body:{rationale:'Prepare deferred state for reopen rollback proof.',expectedStatus:'open',evidence:{proof:'prepare-reopen'}}
});
assert(atomicDefer.status===200,'prepare deferred issue for reopen rollback');
await pool.query("ALTER TABLE operator_audit_event ADD CONSTRAINT tn7_adj2_force_reopen_audit_failure CHECK (action <> 'data_issue.reopen') NOT VALID");
const reopenAtomic=await call(reopenPath(reopenAtomicId),{
  bearer:approver,key:'adj2-reopen-atomic',
  body:{
    rationale:'Force reopen audit failure to prove atomic rollback.',
    expectedStatus:'deferred',
    priorAuditEventId:atomicDefer.payload.auditEventId,
    evidence:{proof:'reopen-rollback'}
  }
});
assert(reopenAtomic.status===500,'forced reopen audit failure returns server error');
assert((await issue(reopenAtomicId)).status==='deferred','reopen mutation rolled back on audit failure');
assert((await audits(reopenAtomicId,'data_issue.reopen')).length===0,'reopen audit failure leaves no reopen audit');
await pool.query('ALTER TABLE operator_audit_event DROP CONSTRAINT tn7_adj2_force_reopen_audit_failure');
console.log('TN7_ADJ2_REOPEN_ATOMIC_ROLLBACK_PASS');

// Audit sequences are monotonic for every issue.
const seqRows=await pool.query('SELECT event_sequence FROM operator_audit_event ORDER BY event_sequence');
for(let i=1;i<seqRows.rows.length;i++){
  if(Number(seqRows.rows[i].event_sequence)<=Number(seqRows.rows[i-1].event_sequence)){
    throw new Error('audit_sequence_not_monotonic');
  }
}
console.log('TN7_ADJ2_AUDIT_SEQUENCE_PASS '+seqRows.rows.length);

const counts=await pool.query("SELECT status,count(*)::int AS count FROM data_issue GROUP BY status ORDER BY status");
console.log('TN7_ADJ2_FINAL '+JSON.stringify(counts.rows));
console.log('TN7_ADJ2_RUNTIME_PASS');

await pool.end();
await new Promise(resolve=>setTimeout(resolve,10000));
