import fs from 'node:fs';

const approval=fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-22-alias-approval.mjs','utf8');
const server=fs.readFileSync('apps/operator-workbench/server.mjs','utf8');
const app=fs.readFileSync('apps/operator-workbench/app.js','utf8');
const html=fs.readFileSync('apps/operator-workbench/index.html','utf8');

const checks=[
 ['approval targets exact NATIONAL-21 proposal',approval.includes("PROPOSAL_ID='057d2830-760d-4bb1-a02b-4f39190e2db6'")],
 ['approval targets Mbazwana rank',approval.includes("acadacb7-ae3b-4581-a28b-ba445af280ba")],
 ['approval requires independent approver',approval.includes('national22_self_approval_forbidden')],
 ['approval uses deterministic decision idempotency key',approval.includes('tn7-national22-mbazwana-alias-approve')],
 ['approval verifies alias applied',approval.includes('aliasApplied')],
 ['approval verifies alias registry applied',approval.includes('registryApplied')],
 ['workbench proxies recovery API',server.includes('RECOVERY_API_URL') && server.includes("'/source-recovery'")],
 ['recovery proxy is GET-only',server.includes("req.method!=='GET'")],
 ['workbench recovery view exists',html.includes('data-view="recovery"') && html.includes('id="recovery"')],
 ['workbench renders rank recovery cases',app.includes('rankRecoveryList')],
 ['workbench renders route recovery cases',app.includes('routeRecoveryList')],
 ['workbench recovery surface is read-only',!server.includes("'/source-recovery/approve'") && !server.includes("'/target-recovery/approve'")],
 ['workbench loads source recovery',app.includes("fetch('/recovery-api/source-recovery'")],
 ['workbench loads target recovery',app.includes("fetch('/recovery-api/target-recovery'")],
 ['workbench loads unlock plan',app.includes("fetch('/recovery-api/unlock-plan'")]
];

const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log((ok?'PASS ':'FAIL ')+name);
if(failed.length){
  console.error('TN7_NATIONAL_22_STATIC_FAIL '+failed.length+'/'+checks.length);
  process.exit(1);
}
console.log('TN7_NATIONAL_22_STATIC_PASS '+checks.length+'/'+checks.length);
