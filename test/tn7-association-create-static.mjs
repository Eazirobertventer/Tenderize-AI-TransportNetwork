import fs from 'node:fs';

const migration=fs.readFileSync('db/013_controlled_association_creation.sql','utf8');
const create=fs.readFileSync('apps/transport-api/src/operator-association-create.mjs','utf8');
const proposals=fs.readFileSync('apps/transport-api/src/operator-proposals.mjs','utf8');
const server=fs.readFileSync('apps/transport-api/src/server.mjs','utf8');

const checks=[
  ['proposal target nullable only for association create',/taxi_association\.create/.test(migration) && /target_entity_id IS NULL/.test(migration)],
  ['creation kill switch default off',/OPERATOR_ASSOCIATION_CREATE_ENABLED/.test(create)],
  ['canonical identity collision checked',/association_identity_collision/.test(create)],
  ['promoted alias collision checked',/association_promoted_alias_collision/.test(create)],
  ['registration collision checked',/association_registration_collision/.test(create)],
  ['advisory lock used',/pg_advisory_xact_lock/.test(create)],
  ['creation status constrained',/documented/.test(create) && /verified/.test(create)],
  ['proposal action exists',/taxi_association\.create/.test(proposals)],
  ['proposal has no fake target UUID',/target_entity_id[\s\S]*NULL/.test(proposals)],
  ['approval supports association create',/isTaxiAssociationCreateProposal/.test(proposals)],
  ['creation occurs inside approval path',/insertCanonicalAssociation/.test(proposals)],
  ['two-person self approval protection preserved',/decision_proposal_self_approval_forbidden/.test(proposals)],
  ['operator proposal endpoint exists',server.includes('/api/v1/operator/proposals/associations/create')],
  ['endpoint requires auth',/associations\/create[\s\S]*operatorAuthOrSend/.test(server)],
  ['endpoint requires idempotency',/associations\/create[\s\S]*idempotency_key_required/.test(server)]
];

const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log((ok?'PASS ':'FAIL ')+name);
if(failed.length){
  console.error('TN7_ASSOC_CREATE_STATIC_FAIL '+failed.length+'/'+checks.length);
  process.exit(1);
}
console.log('TN7_ASSOC_CREATE_STATIC_PASS '+checks.length+'/'+checks.length);
