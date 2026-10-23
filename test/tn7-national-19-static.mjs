import fs from 'node:fs';

const route=fs.readFileSync('apps/transport-api/src/route-evidence-gap-recovery.mjs','utf8');
const rank=fs.readFileSync('apps/kzn-licence-corpus-worker/kzn-rank-target-recovery.mjs','utf8');
const planner=fs.readFileSync('apps/kzn-licence-corpus-worker/kzn-target-recovery.mjs','utf8');
const corpus=fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-8-corpus.mjs','utf8');

const checks=[
 ['reuses national route gap recovery',planner.includes('recoverRouteEvidenceGaps')],
 ['route recovery fuzzy matching disabled',route.includes('fuzzyMatching:false')],
 ['rank recovery fuzzy matching disabled',rank.includes('fuzzyMatching:false')],
 ['rank recovery geographic proximity disabled',rank.includes('geographicProximityMatching:false')],
 ['rank recovery checks source codes',rank.includes('source_rank_external_id') && rank.includes("entity_type='taxi_rank'")],
 ['rank recovery exact phrase matching only',rank.includes('rank_exact_name_or_alias_phrase')],
 ['planner reuses ADJ5 snapshot builder',planner.includes('buildRankAssociationSnapshot')],
 ['planner reuses ADJ5 validator',planner.includes('validateRankAssociationSnapshot')],
 ['planner reuses ADJ6 snapshot loader',planner.includes('loadRouteCandidatePromotionSnapshot')],
 ['planner reuses ADJ6 validator',planner.includes('validateRoutePromotionSnapshot')],
 ['planner supports recovered ADJ5 readiness',planner.includes("state:'adj5_proposal_ready_after_recovery'")],
 ['planner supports recovered ADJ6 readiness',planner.includes("state:'adj6_proposal_ready_after_recovery'")],
 ['automatic candidate creation disabled',planner.includes('automaticCandidateCreation:false')],
 ['automatic alias creation disabled',planner.includes('automaticAliasCreation:false')],
 ['automatic proposal creation disabled',planner.includes('automaticProposalCreation:false')],
 ['automatic approval disabled',planner.includes('automaticApproval:false')],
 ['canonical mutation disabled',planner.includes('canonicalMutation:false')],
 ['corpus builds NATIONAL-19 recovery',corpus.includes('buildNational19RecoveryPlan(client,unlockPlan)')],
 ['target recovery endpoint exposed',corpus.includes("url.pathname==='/target-recovery'")],
 ['corpus remains read only',corpus.includes("BEGIN READ ONLY")]
];

const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log((ok?'PASS ':'FAIL ')+name);
if(failed.length){
  console.error('TN7_NATIONAL_19_STATIC_FAIL '+failed.length+'/'+checks.length);
  process.exit(1);
}
console.log('TN7_NATIONAL_19_STATIC_PASS '+checks.length+'/'+checks.length);
