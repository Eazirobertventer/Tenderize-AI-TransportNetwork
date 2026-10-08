import fs from 'node:fs';

const batch=fs.readFileSync('apps/transport-api/src/kzn-deterministic-adjudication.mjs','utf8');
const server=fs.readFileSync('apps/transport-api/src/server.mjs','utf8');

const checks=[
  ['NATIONAL-3 queue is source',/loadKznGazetteEvidenceQueue/.test(batch)],
  ['only deterministic queue bucket selected',/route_candidate_evidence_ready/.test(batch)],
  ['batch bounded to 13',/maximumBatchSize:13/.test(batch) && /Math\.min\(Math\.max\(Number\(limit\)\|\|13,1\),13\)/.test(batch)],
  ['ADJ5 existing proposal path reused',/createRankAssociationAssignmentProposal/.test(batch)],
  ['ADJ6 existing proposal path reused',/createRoutePromotionProposal/.test(batch)],
  ['two-person control explicit',/twoPersonControlRequired:true/.test(batch)],
  ['automatic approval disabled',/automaticApproval:false/.test(batch)],
  ['canonical direct write denied',/createCanonicalDataDirectly:false/.test(batch)],
  ['ADJ5 precedes ADJ6 when endpoints missing',/adj5BeforeAdj6WhenEndpointAssociationMissing:true/.test(batch)],
  ['blocked evidence path explicit',/adj5_prerequisite_evidence_incomplete/.test(batch)],
  ['no approval function imported',!/approveDecisionProposal/.test(batch)],
  ['operator-only plan endpoint',/operator\/coverage\/kzn\/deterministic-batch/.test(server)],
  ['operator-only proposal endpoint',/operator\/coverage\/kzn\/deterministic-batch\/proposals/.test(server)],
  ['proposal endpoint requires POST',/national4ProposalBatchMatch[\s\S]*method!==['"]POST['"]/.test(server)],
  ['proposal endpoint requires auth',/national4ProposalBatchMatch[\s\S]*operatorAuthOrSend/.test(server)],
  ['proposal endpoint requires idempotency',/national4ProposalBatchMatch[\s\S]*idempotency_key_required/.test(server)],
  ['plan endpoint is read only',/national4PlanMatch[\s\S]*method!==['"]GET['"]/.test(server)]
];

const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log((ok?'PASS ':'FAIL ')+name);
if(failed.length){
  console.error('TN7_NATIONAL_4_STATIC_FAIL '+failed.length+'/'+checks.length);
  process.exit(1);
}
console.log('TN7_NATIONAL_4_STATIC_PASS '+checks.length+'/'+checks.length);
