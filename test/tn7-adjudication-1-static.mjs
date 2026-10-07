import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

for(const path of ['apps/transport-api/src/server.mjs','apps/transport-api/src/operator-auth.mjs','apps/transport-api/src/operator-audit.mjs']){
  execFileSync(process.execPath,['--check',path],{stdio:'pipe'});
}
const api=readFileSync('apps/transport-api/src/server.mjs','utf8');
const auth=readFileSync('apps/transport-api/src/operator-auth.mjs','utf8');
const web=readFileSync('live/server.mjs','utf8');
const migration=readFileSync('db/005_operator_audit.sql','utf8');

const checks=[
  [api.includes("data_issue.defer"),'defer audit action exists'],
  [api.includes("OPERATOR_DEFER_ISSUE_ENABLED"),'defer kill switch exists'],
  [api.includes("FOR UPDATE"),'issue row is locked'],
  [api.includes("BEGIN") && api.includes("COMMIT") && api.includes("ROLLBACK"),'transaction boundaries exist'],
  [api.includes("idempotency_key_required"),'idempotency key required'],
  [api.includes("adjudication_rationale_required"),'rationale required'],
  [api.includes("expected_status_required"),'expected status required'],
  [api.includes("data_issue_status_conflict"),'stale status conflict handled'],
  [api.includes("appendOperatorAuditEvent"),'audit write is part of action'],
  [api.includes("['approver','admin']"),'defer requires approver/admin'],
  [auth.includes("deferIssueEnabled"),'auth capabilities expose kill switch'],
  [migration.includes("operator_audit_event_immutable"),'audit immutability retained'],
  [!web.includes("operator/adjudications"),'public Web does not proxy adjudications']
];
for(const [ok,label] of checks) console.log((ok?'PASS':'FAIL')+' '+label);
if(checks.some(([ok])=>!ok)) process.exit(1);
console.log('TN7_ADJ1_STATIC_PASS '+checks.length+'/'+checks.length);
