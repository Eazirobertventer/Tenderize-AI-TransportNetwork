import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

for(const path of [
  'apps/transport-api/src/server.mjs',
  'apps/transport-api/src/operator-auth.mjs',
  'apps/transport-api/src/operator-proposals.mjs',
  'apps/transport-api/src/operator-routes.mjs'
]){
  execFileSync(process.execPath,['--check',path],{stdio:'pipe'});
}

const api=readFileSync('apps/transport-api/src/server.mjs','utf8');
const auth=readFileSync('apps/transport-api/src/operator-auth.mjs','utf8');
const proposals=readFileSync('apps/transport-api/src/operator-proposals.mjs','utf8');
const routes=readFileSync('apps/transport-api/src/operator-routes.mjs','utf8');
const migration=readFileSync('db/010_route_candidate_promotions.sql','utf8');
const web=readFileSync('live/server.mjs','utf8');

const checks=[
  [migration.includes('ADD COLUMN IF NOT EXISTS source_route_code'),'canonical route preserves source route code explicitly'],
  [migration.includes('route_candidate_promotion'),'route promotion lineage table exists'],
  [migration.includes('candidate_id uuid NOT NULL UNIQUE'),'candidate can promote once'],
  [migration.includes('source_route_geometry_id uuid NOT NULL UNIQUE'),'source geometry can promote once'],
  [migration.includes('route_id uuid NOT NULL UNIQUE'),'promotion maps to one canonical route'],
  [routes.includes("routePromotionEnabled"),'route promotion kill switch exists'],
  [routes.includes("reconciliationStatus!=='exact_endpoint_pair'"),'only exact endpoint candidates are eligible'],
  [routes.includes("route_candidate_association_not_shared_by_endpoints"),'selected association must be canonical at both endpoints'],
  [routes.includes("route_candidate_endpoint_association_conflict"),'multiple shared associations fail closed'],
  [routes.includes("route_candidate_association_conflict"),'candidate association conflict fails closed'],
  [routes.includes("route_candidate_geometry_evidence_only"),'endpoint/demo/inferred geometry is blocked'],
  [routes.includes("geometryHash"),'source geometry hash is frozen'],
  [routes.includes("ST_IsValid"),'geometry validity is checked'],
  [routes.includes("route_candidate_source_record_already_canonical"),'existing source record blocks duplicate promotion'],
  [routes.includes("canonical_route_endpoint_duplicate"),'duplicate canonical endpoint route is blocked'],
  [routes.includes("canonical_route_code_collision"),'route code collision is blocked'],
  [routes.includes("source_route_code"),'source route code is stored without claiming national/board semantics'],
  [routes.includes("INSERT INTO source_record"),'canonical route provenance source record is written'],
  [routes.includes("promoted_route_id"),'source geometry promotion pointer is updated'],
  [routes.includes("registerRouteCandidatePromotion"),'promotion lineage insert exists'],
  [proposals.includes("createRoutePromotionProposal"),'dual-control route proposal exists'],
  [proposals.includes("taxi_route.promote"),'canonical route audit action exists'],
  [proposals.includes("decision_proposal_stale_before_state"),'route approval retains stale-state protection'],
  [proposals.includes("dualControl:true"),'route canonical audit marks dual control'],
  [api.includes("createRoutePromotionProposalMatch"),'route candidate promotion endpoint exists'],
  [auth.includes("routePromotionEnabled"),'auth capabilities expose route switch'],
  [!web.includes("route-candidates") || !web.includes("/api/v1/operator/proposals/route-candidates"),'public Web does not proxy route promotion proposal'],
  [!routes.includes("national_route_code,\n       $"),'source code is not silently assigned as national route code']
];

for(const [ok,label] of checks) console.log((ok?'PASS':'FAIL')+' '+label);
if(checks.some(([ok])=>!ok)) process.exit(1);
console.log('TN7_ADJ6_STATIC_PASS '+checks.length+'/'+checks.length);
