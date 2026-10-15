import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

for(const path of [
  'apps/transport-api/src/server.mjs',
  'apps/transport-api/src/operator-auth.mjs',
  'apps/transport-api/src/operator-audit.mjs',
  'apps/transport-api/src/operator-proposals.mjs'
]){
  execFileSync(process.execPath,['--check',path],{stdio:'pipe'});
}

const api=readFileSync('apps/transport-api/src/server.mjs','utf8');
const auth=readFileSync('apps/transport-api/src/operator-auth.mjs','utf8');
const proposals=readFileSync('apps/transport-api/src/operator-proposals.mjs','utf8');
const migration=readFileSync('db/007_two_person_decision_proposals.sql','utf8');
const web=readFileSync('live/server.mjs','utf8');

const checks=[
  [migration.includes('CREATE TABLE IF NOT EXISTS operator_decision_proposal'),'proposal table exists'],
  [migration.includes("status IN ('proposed','approved','rejected','withdrawn')"),'proposal lifecycle constrained'],
  [migration.includes('before_state_hash'),'proposal freezes before-state hash'],
  [migration.includes('operator_decision_proposal_create_idempotency_idx'),'proposal create idempotency exists'],
  [migration.includes('operator_decision_proposal_decision_idempotency_idx'),'proposal decision idempotency exists'],
  [migration.includes('operator_decision_proposal cannot be deleted'),'proposal deletion blocked'],
  [migration.includes('immutable proposal fields cannot change'),'proposal evidence/rationale and target immutable'],
  [proposals.includes("decision_proposal_self_approval_forbidden"),'self approval explicitly denied'],
  [proposals.includes("decision_proposal_stale_before_state"),'stale before-state rejected'],
  [proposals.includes("canonicalStateHash"),'canonical state hashing exists'],
  [proposals.includes("data_issue.defer"),'first dual-control canonical action is defer'],
  [proposals.includes("decision_proposal.approve"),'approval audit exists'],
  [proposals.includes("decision_proposal.reject"),'proposal rejection audit exists'],
  [proposals.includes("decision_proposal.withdraw"),'proposal withdrawal audit exists'],
  [proposals.includes("proposal_idempotency_key_conflict"),'proposal create key conflict explicit'],
  [proposals.includes("decision_idempotency_key_conflict"),'decision key conflict explicit'],
  [api.includes("createDataIssueDeferProposal"),'proposal creation route wired'],
  [api.includes("approveDecisionProposal"),'proposal approval route wired'],
  [api.includes("rejectDecisionProposal"),'proposal rejection route wired'],
  [api.includes("withdrawDecisionProposal"),'proposal withdrawal route wired'],
  [api.includes("getDecisionProposal"),'proposal read route wired'],
  [auth.includes("dualControlEnabled"),'dual-control capability switch exposed'],
  [!web.includes("/api/v1/operator/proposals"),'public Web does not proxy proposal routes'],
  [proposals.includes("proposer_subject===actor.subject"),'approver identity compared to proposer'],
  [proposals.includes("approved_audit_event_id"),'proposal links canonical mutation audit']
];

for(const [ok,label] of checks) console.log((ok?'PASS':'FAIL')+' '+label);
if(checks.some(([ok])=>!ok)) process.exit(1);
console.log('TN7_ADJ3_STATIC_PASS '+checks.length+'/'+checks.length);
