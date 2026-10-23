import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

for(const path of [
  'apps/transport-api/src/server.mjs',
  'apps/transport-api/src/operator-auth.mjs',
  'apps/transport-api/src/operator-proposals.mjs',
  'apps/transport-api/src/operator-rank-merges.mjs'
]){
  execFileSync(process.execPath,['--check',path],{stdio:'pipe'});
}

const api=readFileSync('apps/transport-api/src/server.mjs','utf8');
const auth=readFileSync('apps/transport-api/src/operator-auth.mjs','utf8');
const proposals=readFileSync('apps/transport-api/src/operator-proposals.mjs','utf8');
const merges=readFileSync('apps/transport-api/src/operator-rank-merges.mjs','utf8');
const migration=readFileSync('db/011_taxi_rank_merge_foundation.sql','utf8');
const web=readFileSync('live/server.mjs','utf8');

const checks=[
  [migration.includes('merged_into_rank_id'),'rank tombstone survivor link exists'],
  [migration.includes('taxi_rank_merge_lineage'),'durable merge lineage exists'],
  [migration.includes('merged taxi_rank tombstone is immutable'),'merged tombstone immutability trigger exists'],
  [migration.includes('merge_proposal_id'),'tombstone links proposal'],
  [migration.includes('merge_audit_event_id'),'tombstone links canonical merge audit'],
  [merges.includes('pg_advisory_xact_lock'),'merge pair uses transaction advisory lock'],
  [merges.includes('rank_merge_pending_proposal_conflict'),'pending rank proposals block merge'],
  [merges.includes('rank_merge_google_place_conflict'),'conflicting Google identity blocks merge'],
  [merges.includes('rank_merge_alias_collision'),'third-party alias collision blocks merge'],
  [merges.includes('rank_merge_promoted_relationship_conflict'),'promoted association relationship blocks merge'],
  [merges.includes('rank_merge_route_self_loop_conflict'),'self-loop route conflict blocks merge'],
  [merges.includes('rank_merge_route_duplicate_conflict'),'projected duplicate route blocks merge'],
  [merges.includes('UPDATE taxi_rank_association'),'canonical association edges redirect'],
  [merges.includes('UPDATE taxi_route'),'canonical route endpoints redirect'],
  [merges.includes("UPDATE data_issue"),'rank data issues redirect'],
  [merges.includes("UPDATE transport_entity_alias"),'promoted aliases redirect'],
  [merges.includes('rank_association_candidate'),'source association evidence is snapshotted'],
  [merges.includes('rank_destination_candidate'),'source destination evidence is snapshotted'],
  [merges.includes('route_candidate'),'route candidate evidence is snapshotted'],
  [proposals.includes('createTaxiRankMergeProposal'),'dual-control rank merge proposal exists'],
  [proposals.includes("taxi_rank.merge"),'canonical merge audit action exists'],
  [proposals.includes('decision_proposal_stale_before_state'),'merge retains stale-state protection'],
  [proposals.includes('dualControl:true'),'merge canonical audit marks dual control'],
  [api.includes("'/api/v1/operator/proposals/rank-merges'"),'rank merge proposal endpoint exists'],
  [api.includes("to_jsonb(r)->>'merged_into_rank_id'"),'operational rank map/counts filter tombstones compatibly'],
  [auth.includes('rankMergeEnabled'),'auth capabilities expose rank merge switch'],
  [!web.includes('/api/v1/operator/proposals/rank-merges'),'public Web does not proxy merge proposal']
];

for(const [ok,label] of checks) console.log((ok?'PASS':'FAIL')+' '+label);
if(checks.some(([ok])=>!ok)) process.exit(1);
console.log('TN7_ADJ7_STATIC_PASS '+checks.length+'/'+checks.length);
