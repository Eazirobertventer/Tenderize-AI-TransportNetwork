import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

for(const path of [
  'apps/transport-api/src/server.mjs',
  'apps/transport-api/src/operator-auth.mjs',
  'apps/transport-api/src/operator-audit.mjs'
]){
  execFileSync(process.execPath,['--check',path],{stdio:'pipe'});
}

const api=readFileSync('apps/transport-api/src/server.mjs','utf8');
const auth=readFileSync('apps/transport-api/src/operator-auth.mjs','utf8');
const web=readFileSync('live/server.mjs','utf8');
const migration=readFileSync('db/006_data_issue_rejected_status.sql','utf8');

const checks=[
  [migration.includes("'rejected'"),'migration adds explicit rejected status'],
  [migration.includes('event_sequence bigint GENERATED ALWAYS AS IDENTITY'),'migration adds monotonic audit sequence'],
  [migration.includes('operator_audit_event_entity_sequence_idx'),'entity audit sequence index exists'],
  [api.includes("async function rejectDataIssue"),'reject transaction exists'],
  [api.includes("async function reopenDataIssue"),'reopen transaction exists'],
  [api.includes("data_issue.reject"),'reject audit action exists'],
  [api.includes("data_issue.reopen"),'reopen audit action exists'],
  [api.includes("adjudication_evidence_required"),'reject requires evidence'],
  [api.includes("prior_audit_event_required"),'reopen requires prior audit event'],
  [api.includes("prior_adjudication_not_latest"),'reopen enforces latest reversible decision'],
  [api.includes("ORDER BY event_sequence DESC"),'latest audit uses monotonic sequence'],
  [api.includes("prior_adjudication_state_mismatch"),'reopen binds prior after-state to current state'],
  [api.includes("prior_adjudication_restore_state_invalid"),'reopen restores only safe prior state'],
  [api.includes("OPERATOR_REJECT_ISSUE_ENABLED"),'reject kill switch exists'],
  [api.includes("OPERATOR_REOPEN_ISSUE_ENABLED"),'reopen kill switch exists'],
  [auth.includes("rejectIssueEnabled"),'auth capabilities expose reject switch'],
  [auth.includes("reopenIssueEnabled"),'auth capabilities expose reopen switch'],
  [!web.includes("operator/adjudications"),'public Web still does not proxy adjudication'],
  [api.includes("['approver','admin']"),'mutations remain approver/admin only']
];

for(const [ok,label] of checks) console.log((ok?'PASS':'FAIL')+' '+label);
if(checks.some(([ok])=>!ok)) process.exit(1);
console.log('TN7_ADJ2_STATIC_PASS '+checks.length+'/'+checks.length);
