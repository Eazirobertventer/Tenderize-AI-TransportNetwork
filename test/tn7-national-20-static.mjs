import fs from 'node:fs';

const evidence=JSON.parse(fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-20-source-recovery.json','utf8'));
const planner=fs.readFileSync('apps/kzn-licence-corpus-worker/kzn-source-recovery.mjs','utf8');
const corpus=fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-8-corpus.mjs','utf8');

const checks=[
 ['18 documentary route recoveries banked',evidence.routeIdentityRecoveries.length===18],
 ['one unresolved route identity retained',evidence.unresolvedRouteIdentities.length===1],
 ['two missing-rank source candidates banked',evidence.missingRankSourceCandidates.length===2],
 ['Mbazwana has documented coordinates',evidence.missingRankSourceCandidates.some(x=>x.canonicalNameCandidate==='Mbazwana Taxi Rank' && Number.isFinite(x.latitude) && Number.isFinite(x.longitude))],
 ['Gluckstadt remains location pending',evidence.missingRankSourceCandidates.some(x=>x.canonicalNameCandidate==='Gluckstadt Taxi Rank' && x.locationStatus==='location_pending')],
 ['geometry invention disabled',evidence.policy.geometryInvented===false],
 ['coordinate invention disabled',evidence.policy.coordinatesInvented===false],
 ['automatic route candidate creation disabled',evidence.policy.automaticRouteCandidateCreation===false],
 ['automatic rank creation disabled',evidence.policy.automaticRankCreation===false],
 ['planner collision-checks canonical rank name',planner.includes('normalize_transport_identity_name(canonical_name)')],
 ['planner uses proximity only for collision review',planner.includes('nearbyCollisionReview') && planner.includes('nearbyCoordinatesUsedForCollisionReviewOnly:true')],
 ['planner never marks documentary routes candidate-ready',planner.includes('routeCandidateCreationReady:false')],
 ['planner distinguishes geometry recovery requirement',planner.includes("nextAction:'source_geometry_recovery_required'")],
 ['planner distinguishes location-pending rank',planner.includes("state='documented_missing_rank_location_pending'")],
 ['fuzzy matching disabled',planner.includes('fuzzyMatching:false')],
 ['automatic proposal creation disabled',planner.includes('automaticProposalCreation:false')],
 ['canonical mutation disabled',planner.includes('canonicalMutation:false')],
 ['corpus builds NATIONAL-20 source recovery',corpus.includes('buildNational20SourceRecoveryPlan(client,targetRecovery)')],
 ['source recovery endpoint exposed',corpus.includes("url.pathname==='/source-recovery'")],
 ['corpus remains read only',corpus.includes("BEGIN READ ONLY")]
];

const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log((ok?'PASS ':'FAIL ')+name);
if(failed.length){
  console.error('TN7_NATIONAL_20_STATIC_FAIL '+failed.length+'/'+checks.length);
  process.exit(1);
}
console.log('TN7_NATIONAL_20_STATIC_PASS '+checks.length+'/'+checks.length);
