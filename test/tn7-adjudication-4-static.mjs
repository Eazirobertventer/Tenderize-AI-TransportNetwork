import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

for(const path of [
  'apps/transport-api/src/server.mjs',
  'apps/transport-api/src/operator-auth.mjs',
  'apps/transport-api/src/operator-proposals.mjs',
  'apps/transport-api/src/operator-aliases.mjs'
]){
  execFileSync(process.execPath,['--check',path],{stdio:'pipe'});
}

const api=readFileSync('apps/transport-api/src/server.mjs','utf8');
const auth=readFileSync('apps/transport-api/src/operator-auth.mjs','utf8');
const proposals=readFileSync('apps/transport-api/src/operator-proposals.mjs','utf8');
const aliases=readFileSync('apps/transport-api/src/operator-aliases.mjs','utf8');
const migration=readFileSync('db/008_transport_entity_aliases.sql','utf8');
const web=readFileSync('live/server.mjs','utf8');

const checks=[
  [migration.includes('ADD COLUMN IF NOT EXISTS aliases'),'association aliases column exists'],
  [migration.includes('normalize(value, NFKC)'),'database normalization uses NFKC'],
  [migration.includes('normalize_transport_identity_name'),'single DB normalization function exists'],
  [migration.includes('CREATE TABLE IF NOT EXISTS transport_entity_alias'),'generic alias registry exists'],
  [migration.includes('transport_entity_alias_normalized_unique'),'normalized alias uniqueness index exists'],
  [aliases.includes("pg_advisory_xact_lock"),'alias claim uses transaction advisory lock'],
  [aliases.includes("normalize_transport_identity_name(canonical_name)"),'canonical names participate in collision checks'],
  [aliases.includes("unnest(coalesce(aliases"),'legacy aliases participate in collision checks'],
  [aliases.includes("normalize_transport_identity_name(acronym)"),'association acronym participates in collision checks'],
  [aliases.includes("array_append(aliases"),'alias arrays are synchronized'],
  [aliases.includes("transport_entity_alias"),'promoted alias registry insert exists'],
  [proposals.includes("createAliasProposal"),'alias proposal creation exists'],
  [proposals.includes("taxi_rank.alias.add"),'rank alias action supported'],
  [proposals.includes("taxi_association.alias.add"),'association alias action supported'],
  [proposals.includes("aliasPromotionEnabled"),'approval requires alias promotion kill switch'],
  [proposals.includes("lockAliasClaim"),'approval locks normalized alias claim'],
  [proposals.includes("findAliasCollision"),'approval rechecks collisions'],
  [proposals.includes("decision_proposal_stale_before_state"),'alias approval retains stale-state protection'],
  [proposals.includes("dualControl:true"),'alias canonical audit retains dual-control flag'],
  [proposals.includes("registerPromotedAlias"),'alias registry write is inside approval transaction'],
  [api.includes("proposals/ranks"),'rank alias proposal route exists'],
  [api.includes("proposals/associations"),'association alias proposal route exists'],
  [auth.includes("aliasPromotionEnabled"),'auth capabilities expose alias promotion switch'],
  [!web.includes("/api/v1/operator/proposals"),'public Web still does not proxy proposal routes']
];

for(const [ok,label] of checks) console.log((ok?'PASS':'FAIL')+' '+label);
if(checks.some(([ok])=>!ok)) process.exit(1);
console.log('TN7_ADJ4_STATIC_PASS '+checks.length+'/'+checks.length);
