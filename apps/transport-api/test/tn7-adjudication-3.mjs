import { createHmac } from 'node:crypto';
import pg from 'pg';

const { Pool }=pg;
const api=(process.env.API_BASE||'').replace(/\/$/,'');
const secret=process.env.OPERATOR_JWT_SECRET||'';
const issuer=process.env.OPERATOR_JWT_ISSUER||'';
const audience=process.env.OPERATOR_JWT_AUDIENCE||'';
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:false,max:4});

if(!api || secret.length<32 || !issuer || !audience || !process.env.DATABASE_URL){
  throw new Error('runtime_configuration_missing');
}

function b64(value){
  return Buffer.from(value).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
function token(sub,roles){
  const now=Math.floor(Date.now()/1000);
  const h=b64(JSON.stringify({alg:'HS256',typ:'JWT'}));
  const p=b64(JSON.stringify({iss:issuer,aud:audience,sub,roles,iat:now-5,exp:now+1200,jti:sub+'-'+now}));
  const s=createHmac('sha256',secret).update(h+'.'+p).digest('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  return h+'.'+p+'.'+s;
}
async function call(path,{method='POST',bearer=null,key=null,body=null}={}){
  const headers={'content-type':'application/json'};
  if(bearer) headers.authorization='Bearer '+bearer;
  if(key) headers['idempotency-key']=key;
  const response=await fetch(api+path,{method,headers,body:method==='GET'?undefined:JSON.stringify(body||{})});
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
  const r=await pool.query('SELECT id::text,summary,status,resolved_at FROM data_issue WHERE id=$1::uuid',[id]);
  return r.rows[0];
}
async function proposal(id){
  const r=await pool.query(
    `SELECT id::text,status,action,target_entity_id::text,before_state_hash,proposer_subject,
            decision_actor_subject,decision_idempotency_key,approved_audit_event_id::text
     FROM operator_decision_proposal WHERE id=$1::uuid`,
    [id]
  );
  return r.rows[0];
}
async function auditsByProposal(id){
  const r=await pool.query(
    `SELECT id::text,event_sequence,action,actor_subject,entity_id::text,metadata
     FROM operator_audit_event
     WHERE (entity_type='operator_decision_proposal' AND entity_id=$1::uuid)
        OR metadata->>'proposalId'=$1
     ORDER BY event_sequence`,
    [id]
  );
  return r.rows;
}
async function entityAudits(id,action=null){
  const params=[id];
  let where='entity_id=$1::uuid';
  if(action){params.push(action);where+=' AND action=$2';}
  const r=await pool.query(
    `SELECT id::text,event_sequence,action,actor_subject,before_state,after_state,metadata
     FROM operator_audit_event
     WHERE ${where}
     ORDER BY event_sequence`,
    params
  );
  return r.rows;
}

const reviewer=token('adj3-reviewer',['reviewer']);
const reviewer2=token('adj3-reviewer-2',['reviewer']);
const approver=token('adj3-approver',['approver']);
const approver2=token('adj3-approver-2',['approver']);
const admin=token('adj3-admin',['admin']);

const approveIssue='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const selfIssue='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const staleIssue='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const rejectIssue='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const withdrawIssue='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const atomicIssue='ffffffff-ffff-4fff-8fff-ffffffffffff';
const concurrentIssue='12121212-1212-4212-8212-121212121212';
const conflictIssue='13131313-1313-4313-8313-131313131313';

const createPath=id=>'/api/v1/operator/proposals/data-issues/'+id+'/defer';
const approvePath=id=>'/api/v1/operator/proposals/'+id+'/approve';
const rejectPath=id=>'/api/v1/operator/proposals/'+id+'/reject';
const withdrawPath=id=>'/api/v1/operator/proposals/'+id+'/withdraw';
const getPath=id=>'/api/v1/operator/proposals/'+id;

const proposalBody=(expectedStatus='open')=>({
  rationale:'Propose defer pending stronger authoritative transport-network evidence.',
  expectedStatus,
  evidence:{source:'tn7-adj3-proof',reason:'await-authoritative-evidence'}
});
const decisionBody={
  rationale:'Independent approver verified the evidence and frozen before-state.',
  evidence:{review:'independent-second-person-check'}
};

// Direct one-person mutation remains disabled in ADJ3 proof.
const direct=await call('/api/v1/operator/adjudications/data-issues/'+approveIssue+'/defer',{
  bearer:approver,key:'adj3-direct-disabled',
  body:{rationale:'Direct path must remain disabled in dual-control proof.',expectedStatus:'open',evidence:{guard:true}}
});
assert(direct.status===503 && direct.payload.error==='adjudication_defer_disabled','direct one-person defer remains disabled');

// Proposal creation boundaries.
assert((await call(createPath(approveIssue),{key:'adj3-anon-create',body:proposalBody()})).status===401,'anonymous proposal rejected');

const created=await call(createPath(approveIssue),{
  bearer:reviewer,key:'adj3-create-main',body:proposalBody()
});
assert(created.status===201 && created.payload.replay===false,'reviewer creates defer proposal');
const mainProposalId=created.payload.proposal.id;
assert(created.payload.proposal.status==='proposed','new proposal is pending');
assert(created.payload.proposal.proposer.subject==='adj3-reviewer','proposer identity frozen');
assert(/^[0-9a-f]{64}$/.test(created.payload.proposal.beforeStateHash),'before-state SHA-256 stored');
assert((await issue(approveIssue)).status==='open','proposal creation does not mutate issue');

const getProposal=await call(getPath(mainProposalId),{method:'GET',bearer:reviewer});
assert(getProposal.status===200 && getProposal.payload.proposal.id===mainProposalId,'trusted operator reads proposal');

const createReplay=await call(createPath(approveIssue),{
  bearer:reviewer,key:'adj3-create-main',body:proposalBody()
});
assert(createReplay.status===200 && createReplay.payload.replay===true,'proposal creation replays safely');

const createConflict=await call(createPath(conflictIssue),{
  bearer:reviewer,key:'adj3-create-main',body:proposalBody()
});
assert(createConflict.status===409 && createConflict.payload.error==='proposal_idempotency_key_conflict','proposal key cannot be reused for different target');

// Self approval must fail.
const selfProposal=await call(createPath(selfIssue),{
  bearer:approver,key:'adj3-self-create',body:proposalBody()
});
assert(selfProposal.status===201,'approver may propose');
const selfProposalId=selfProposal.payload.proposal.id;
const selfApprove=await call(approvePath(selfProposalId),{
  bearer:approver,key:'adj3-self-approve',body:decisionBody
});
assert(selfApprove.status===403 && selfApprove.payload.error==='decision_proposal_self_approval_forbidden','self approval denied');
assert((await issue(selfIssue)).status==='open','self approval denial leaves issue unchanged');

// Different approver approves and atomically mutates canonical issue.
const approved=await call(approvePath(mainProposalId),{
  bearer:approver,key:'adj3-approve-main',body:decisionBody
});
assert(approved.status===200 && approved.payload.replay===false,'different approver approves proposal');
assert(approved.payload.canonicalMutation?.action==='data_issue.defer','approval executes proposed canonical action');
assert((await issue(approveIssue)).status==='deferred','approved proposal defers issue');

const approvedRow=await proposal(mainProposalId);
assert(approvedRow.status==='approved','proposal marked approved');
assert(approvedRow.proposer_subject!==approvedRow.decision_actor_subject,'proposer and approver are different subjects');
assert(Boolean(approvedRow.approved_audit_event_id),'proposal links canonical mutation audit');

const canonicalAudits=await entityAudits(approveIssue,'data_issue.defer');
assert(canonicalAudits.length===1,'exactly one canonical defer audit written');
assert(canonicalAudits[0].actor_subject==='adj3-approver','canonical mutation attributed to approver');
assert(canonicalAudits[0].metadata.dualControl===true,'canonical audit marks dual control');
assert(canonicalAudits[0].metadata.proposerSubject==='adj3-reviewer','canonical audit links proposer');
assert(canonicalAudits[0].metadata.approverSubject==='adj3-approver','canonical audit links approver');

const proposalAudits=await entityAudits(mainProposalId);
assert(proposalAudits.some(x=>x.action==='decision_proposal.create'),'proposal creation audited');
assert(proposalAudits.some(x=>x.action==='decision_proposal.approve'),'proposal approval audited');

const approvalReplay=await call(approvePath(mainProposalId),{
  bearer:approver,key:'adj3-approve-main',body:decisionBody
});
assert(approvalReplay.status===200 && approvalReplay.payload.replay===true,'approval replay is idempotent');
assert((await entityAudits(approveIssue,'data_issue.defer')).length===1,'approval replay does not duplicate canonical audit');

// Decision key conflict across different proposal.
const otherApprove=await call(approvePath(selfProposalId),{
  bearer:approver2,key:'adj3-shared-decision-key',body:decisionBody
});
assert(otherApprove.status===200,'second approver can approve self-test proposal');
const conflictProposal=await call(createPath(conflictIssue),{
  bearer:reviewer,key:'adj3-conflict-create',body:proposalBody()
});
assert(conflictProposal.status===201,'conflict target proposal created');
const conflictDecision=await call(approvePath(conflictProposal.payload.proposal.id),{
  bearer:approver2,key:'adj3-shared-decision-key',body:decisionBody
});
assert(conflictDecision.status===409 && conflictDecision.payload.error==='decision_idempotency_key_conflict','decision key cannot be reused across proposals');

// Stale before-state hash blocks approval.
const staleProposal=await call(createPath(staleIssue),{
  bearer:reviewer,key:'adj3-stale-create',body:proposalBody()
});
assert(staleProposal.status===201,'stale-state proposal created');
await pool.query("UPDATE data_issue SET summary='Changed after proposal snapshot' WHERE id=$1::uuid",[staleIssue]);
const staleApproval=await call(approvePath(staleProposal.payload.proposal.id),{
  bearer:approver,key:'adj3-stale-approve',body:decisionBody
});
assert(staleApproval.status===409 && staleApproval.payload.error==='decision_proposal_stale_before_state','stale proposal approval rejected');
assert((await issue(staleIssue)).status==='open','stale proposal leaves canonical status unchanged');
assert((await proposal(staleProposal.payload.proposal.id)).status==='proposed','stale proposal remains pending');

// Proposal rejection by independent approver, no canonical mutation.
const rejectProposal=await call(createPath(rejectIssue),{
  bearer:reviewer,key:'adj3-reject-create',body:proposalBody()
});
assert(rejectProposal.status===201,'reject-test proposal created');
const rejected=await call(rejectPath(rejectProposal.payload.proposal.id),{
  bearer:approver,key:'adj3-proposal-reject',
  body:{rationale:'Independent review rejects this proposed defer.',evidence:{reason:'insufficient-basis'}}
});
assert(rejected.status===200 && rejected.payload.proposal.status==='rejected','independent approver rejects proposal');
assert((await issue(rejectIssue)).status==='open','proposal rejection makes no canonical change');
assert((await call(approvePath(rejectProposal.payload.proposal.id),{
  bearer:approver2,key:'adj3-approve-rejected',body:decisionBody
})).status===409,'rejected proposal cannot later be approved');

// Proposer withdrawal and foreign withdrawal denial.
const withdrawProposal=await call(createPath(withdrawIssue),{
  bearer:reviewer,key:'adj3-withdraw-create',body:proposalBody('reviewing')
});
assert(withdrawProposal.status===201,'withdraw-test proposal created');
assert((await call(withdrawPath(withdrawProposal.payload.proposal.id),{
  bearer:reviewer2,key:'adj3-foreign-withdraw',
  body:{rationale:'Different reviewer must not withdraw another proposer decision.'}
})).status===403,'different reviewer cannot withdraw proposal');
const withdrawn=await call(withdrawPath(withdrawProposal.payload.proposal.id),{
  bearer:reviewer,key:'adj3-owner-withdraw',
  body:{rationale:'Proposer withdraws pending proposal after evidence changed.'}
});
assert(withdrawn.status===200 && withdrawn.payload.proposal.status==='withdrawn','proposer withdraws own proposal');
assert((await issue(withdrawIssue)).status==='reviewing','withdraw leaves canonical issue unchanged');

// Concurrent same-key approval: one mutation, one replay.
const concurrentProposal=await call(createPath(concurrentIssue),{
  bearer:reviewer,key:'adj3-concurrent-create',body:proposalBody()
});
assert(concurrentProposal.status===201,'concurrent approval proposal created');
const concurrent=await Promise.all([
  call(approvePath(concurrentProposal.payload.proposal.id),{bearer:admin,key:'adj3-concurrent-approve',body:decisionBody}),
  call(approvePath(concurrentProposal.payload.proposal.id),{bearer:admin,key:'adj3-concurrent-approve',body:decisionBody})
]);
assert(concurrent.every(x=>x.status===200),'concurrent approval requests both return safely');
assert(concurrent.filter(x=>x.payload.replay===false).length===1,'exactly one concurrent approval mutates');
assert(concurrent.filter(x=>x.payload.replay===true).length===1,'exactly one concurrent approval replays');
assert((await entityAudits(concurrentIssue,'data_issue.defer')).length===1,'concurrent approval writes one canonical audit');

// Proposal immutable fields and deletion are DB-enforced.
let immutableBlocked=false;
try{
  await pool.query("UPDATE operator_decision_proposal SET rationale='tampered proposal' WHERE id=$1::uuid",[mainProposalId]);
}catch(error){ immutableBlocked=String(error.message).includes('immutable proposal fields'); }
assert(immutableBlocked,'proposal frozen rationale cannot be altered');

let deleteBlocked=false;
try{
  await pool.query('DELETE FROM operator_decision_proposal WHERE id=$1::uuid',[mainProposalId]);
}catch(error){ deleteBlocked=String(error.message).includes('cannot be deleted'); }
assert(deleteBlocked,'proposal deletion blocked');

// Approval atomic rollback: canonical change, canonical audit and proposal approval all rollback together.
const atomicProposal=await call(createPath(atomicIssue),{
  bearer:reviewer,key:'adj3-atomic-create',body:proposalBody()
});
assert(atomicProposal.status===201,'atomic rollback proposal created');
await pool.query("ALTER TABLE operator_audit_event ADD CONSTRAINT tn7_adj3_force_approval_audit_failure CHECK (action <> 'decision_proposal.approve') NOT VALID");
const atomicApproval=await call(approvePath(atomicProposal.payload.proposal.id),{
  bearer:approver,key:'adj3-atomic-approve',body:decisionBody
});
assert(atomicApproval.status===500,'forced final approval audit failure returns server error');
assert((await issue(atomicIssue)).status==='open','canonical mutation rolled back when final approval audit fails');
assert((await proposal(atomicProposal.payload.proposal.id)).status==='proposed','proposal approval state rolled back');
assert((await entityAudits(atomicIssue,'data_issue.defer')).length===0,'canonical audit rolled back with transaction');
assert((await entityAudits(atomicProposal.payload.proposal.id,'decision_proposal.approve')).length===0,'failed approval audit not persisted');
await pool.query('ALTER TABLE operator_audit_event DROP CONSTRAINT tn7_adj3_force_approval_audit_failure');
console.log('TN7_ADJ3_ATOMIC_APPROVAL_ROLLBACK_PASS');

// Audit and proposal ordering inspection.
const sequences=await pool.query('SELECT event_sequence FROM operator_audit_event ORDER BY event_sequence');
for(let i=1;i<sequences.rows.length;i++){
  if(Number(sequences.rows[i].event_sequence)<=Number(sequences.rows[i-1].event_sequence)){
    throw new Error('audit_sequence_not_monotonic');
  }
}
console.log('TN7_ADJ3_AUDIT_SEQUENCE_PASS '+sequences.rows.length);

const proposalCounts=await pool.query('SELECT status,count(*)::int AS count FROM operator_decision_proposal GROUP BY status ORDER BY status');
const issueCounts=await pool.query('SELECT status,count(*)::int AS count FROM data_issue GROUP BY status ORDER BY status');
console.log('TN7_ADJ3_PROPOSALS '+JSON.stringify(proposalCounts.rows));
console.log('TN7_ADJ3_ISSUES '+JSON.stringify(issueCounts.rows));
console.log('TN7_ADJ3_RUNTIME_PASS');

await pool.end();
await new Promise(resolve=>setTimeout(resolve,10000));
