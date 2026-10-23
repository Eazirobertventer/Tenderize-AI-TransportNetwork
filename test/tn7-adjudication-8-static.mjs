import fs from 'node:fs';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration=read('db/012_taxi_association_merge_foundation.sql');
const merge=read('apps/transport-api/src/operator-association-merges.mjs');
const proposals=read('apps/transport-api/src/operator-proposals.mjs');
const server=read('apps/transport-api/src/server.mjs');
const auth=read('apps/transport-api/src/operator-auth.mjs');

const checks=[
  ['migration 012 tombstone survivor',migration.includes('merged_into_association_id')],
  ['migration 012 merge proposal lineage',migration.includes('merge_proposal_id')],
  ['migration 012 merge audit lineage',migration.includes('merge_audit_event_id')],
  ['association merge lineage table',migration.includes('taxi_association_merge_lineage')],
  ['tombstone consistency constraint',migration.includes('taxi_association_merge_state_consistent')],
  ['tombstone immutable trigger',migration.includes('guard_merged_taxi_association_tombstone')],
  ['default-off association merge switch',merge.includes("OPERATOR_ASSOCIATION_MERGE_ENABLED==='true'")],
  ['pair advisory lock',merge.includes('taxi-association-merge:')],
  ['same entity blocked',merge.includes('association_merge_same_entity')],
  ['existing tombstone blocked',merge.includes('association_merge_duplicate_already_merged')],
  ['registration conflict blocked',merge.includes('association_merge_registration_conflict')],
  ['third party identity collision blocked',merge.includes('association_merge_identity_collision')],
  ['promoted relationship conflict blocked',merge.includes('association_merge_promoted_relationship_conflict')],
  ['projected duplicate route conflict blocked',merge.includes('association_merge_route_duplicate_conflict')],
  ['source records frozen',merge.includes("entity_type='taxi_association'")],
  ['pending proposals frozen',merge.includes("target_entity_type='taxi_association'")],
  ['route candidates frozen',merge.includes('FROM route_candidate')],
  ['safe relationship collapse',merge.includes('overlappingRelationshipsCollapsed')],
  ['canonical relationships redirect',merge.includes('SET association_id=$1::uuid')],
  ['canonical routes redirect',merge.includes('routesRedirected')],
  ['active issue redirect',merge.includes("entity_type='taxi_association' AND entity_id=$2::uuid")],
  ['promoted aliases redirect',merge.includes("entity_type='taxi_association' AND entity_id=$2::uuid")],
  ['ADJ3 proposal integration',proposals.includes("const action='taxi_association.merge'")],
  ['ADJ3 approval integration',proposals.includes('isTaxiAssociationMergeProposal')],
  ['canonical association merge audit',proposals.includes("action:'taxi_association.merge'")],
  ['ADJ8 gate metadata',proposals.includes("gate:'TN7-ADJUDICATION-8'")],
  ['protected association merge endpoint',server.includes("/api/v1/operator/proposals/association-merges")],
  ['association tombstones hidden from list/map',server.includes("merged_into_association_id")],
  ['capability surfaced',auth.includes('associationMergeEnabled')],
  ['public method guard retained',server.includes("if(!['GET','HEAD'].includes(method))")]
];

for(const [name,ok] of checks){
  if(!ok) throw new Error('TN7_ADJ8_STATIC_FAIL: '+name);
  console.log('PASS '+name);
}
console.log('TN7_ADJ8_STATIC_PASS '+checks.length+'/'+checks.length);
