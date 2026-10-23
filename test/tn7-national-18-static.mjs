import fs from 'node:fs';

const planner=fs.readFileSync('apps/kzn-licence-corpus-worker/kzn-post-canonical-unlock.mjs','utf8');
const corpus=fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-8-corpus.mjs','utf8');

const checks=[
 ['targets nine canonical associations',planner.includes('NATIONAL18_ASSOCIATION_NAMES')],
 ['reuses ADJ5 snapshot builder',planner.includes('buildRankAssociationSnapshot')],
 ['reuses ADJ5 validator',planner.includes('validateRankAssociationSnapshot')],
 ['reuses ADJ6 snapshot loader',planner.includes('loadRouteCandidatePromotionSnapshot')],
 ['reuses ADJ6 validator',planner.includes('validateRoutePromotionSnapshot')],
 ['ADJ6 ready state supported',planner.includes("state:'adj6_proposal_ready'")],
 ['ADJ5 prerequisite state supported',planner.includes("state:'adj5_prerequisites_ready'")],
 ['direct ADJ5 ready state supported',planner.includes("state:'adj5_proposal_ready'")],
 ['automatic proposal creation disabled',planner.includes('automaticProposalCreation:false')],
 ['automatic approval disabled',planner.includes('automaticApproval:false')],
 ['canonical mutation disabled',planner.includes('canonicalMutation:false')],
 ['corpus builds NATIONAL-18 plan',corpus.includes('buildNational18UnlockPlan(client,boundedQueue)')],
 ['unlock endpoint exposed',corpus.includes("url.pathname==='/unlock-plan'")],
 ['corpus transaction remains read only',corpus.includes("BEGIN READ ONLY")]
];

const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log((ok?'PASS ':'FAIL ')+name);
if(failed.length){
  console.error('TN7_NATIONAL_18_STATIC_FAIL '+failed.length+'/'+checks.length);
  process.exit(1);
}
console.log('TN7_NATIONAL_18_STATIC_PASS '+checks.length+'/'+checks.length);
