import fs from 'node:fs';

const runner=fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-24-adj5-approval.mjs','utf8');

const checks=[
 ['targets exact ADJ5 proposal',runner.includes("PROPOSAL_ID='1c77e981-5de9-412a-a149-26e23289cae2'")],
 ['targets exact candidate',runner.includes("CANDIDATE_ID='3d02304d-7024-40d0-ad0f-809b06607687'")],
 ['targets exact rank',runner.includes("RANK_ID='acadacb7-ae3b-4581-a28b-ba445af280ba'")],
 ['targets exact association',runner.includes("ASSOCIATION_ID='1561a588-e225-4af3-b5ca-12ba5e754f4a'")],
 ['requires independent approver',runner.includes('national24_self_approval_forbidden')],
 ['requires approver role',runner.includes('independent_approver_role_required')],
 ['uses stable decision idempotency key',runner.includes('tn7-national24-mbazwana-adj5-approve')],
 ['uses controlled proposal approval primitive',runner.includes('approveDecisionProposal')],
 ['requires one relationship',runner.includes('relationship.length===1')],
 ['requires one promotion',runner.includes('promotion.length===1')],
 ['requires proposal approved',runner.includes("result.result.proposal?.status==='approved'")],
 ['replay creates no second relationship',runner.includes('result.result.replay?0:1')],
 ['relationship mutation is explicit',runner.includes('canonicalRelationshipMutationOnApproval:true')],
 ['candidate promotion is required',runner.includes('candidatePromotionRequired:true')]
];

const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log((ok?'PASS ':'FAIL ')+name);
if(failed.length){
  console.error('TN7_NATIONAL_24_STATIC_FAIL '+failed.length+'/'+checks.length);
  process.exit(1);
}
console.log('TN7_NATIONAL_24_STATIC_PASS '+checks.length+'/'+checks.length);
