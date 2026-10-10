import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

for(const path of [
  'apps/transport-api/src/server.mjs',
  'apps/transport-api/src/operator-auth.mjs',
  'apps/transport-api/src/operator-proposals.mjs',
  'apps/transport-api/src/operator-association-links.mjs'
]){
  execFileSync(process.execPath,['--check',path],{stdio:'pipe'});
}

const api=readFileSync('apps/transport-api/src/server.mjs','utf8');
const auth=readFileSync('apps/transport-api/src/operator-auth.mjs','utf8');
const proposals=readFileSync('apps/transport-api/src/operator-proposals.mjs','utf8');
const links=readFileSync('apps/transport-api/src/operator-association-links.mjs','utf8');
const migration=readFileSync('db/009_rank_association_promotions.sql','utf8');
const web=readFileSync('live/server.mjs','utf8');

const checks=[
  [migration.includes('relationship_id uuid'),'canonical relationship gets stable UUID identity'],
  [migration.includes('rank_association_promotion'),'promotion lineage table exists'],
  [migration.includes('UNIQUE (candidate_id)'),'candidate can be promoted once'],
  [migration.includes('UNIQUE (promoted_by_proposal_id)'),'proposal can promote one relationship once'],
  [links.includes("associationAssignmentEnabled"),'association assignment kill switch exists'],
  [links.includes("rank_association_candidate_rank_unresolved"),'unresolved candidate rank fails closed'],
  [links.includes("candidateMatchesAssociation"),'candidate identity must match target association'],
  [links.includes("competingCandidateLabels"),'competing candidate labels are detected'],
  [links.includes("rank_association_relationship_exists"),'duplicate canonical relationship is blocked'],
  [links.includes("rank_association_candidate_already_promoted"),'already promoted candidate is blocked'],
  [links.includes("pg_advisory_xact_lock"),'rank assignment uses transaction advisory lock'],
  [links.includes("normalize_transport_identity_name"),'candidate/association identity normalization uses DB authority'],
  [links.includes("INSERT INTO taxi_rank_association"),'canonical relationship insert exists'],
  [links.includes("'verified'"),'human-approved relationship is stored verified'],
  [links.includes("registerRankAssociationPromotion"),'promotion lineage insert exists'],
  [proposals.includes("createRankAssociationAssignmentProposal"),'dual-control assignment proposal exists'],
  [proposals.includes("taxi_rank_association.assign"),'canonical assignment audit action exists'],
  [proposals.includes("decision_proposal_stale_before_state"),'assignment retains stale-state protection'],
  [proposals.includes("dualControl:true"),'assignment canonical audit marks dual control'],
  [proposals.includes("promotionId"),'proposal approval audit links promotion lineage'],
  [api.includes("createRankAssociationProposalMatch"),'candidate assignment proposal route exists'],
  [auth.includes("associationAssignmentEnabled"),'auth capabilities expose assignment switch'],
  [!web.includes("rank-association-candidates"),'public Web does not proxy assignment proposal route'],
  [!web.includes("/api/v1/operator/proposals"),'public Web still excludes operator proposal routes']
];

for(const [ok,label] of checks) console.log((ok?'PASS':'FAIL')+' '+label);
if(checks.some(([ok])=>!ok)) process.exit(1);
console.log('TN7_ADJ5_STATIC_PASS '+checks.length+'/'+checks.length);
