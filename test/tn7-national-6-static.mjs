import fs from 'node:fs';

const generic=fs.readFileSync('apps/transport-api/src/association-identity-resolution.mjs','utf8');
const kzn=fs.readFileSync('apps/transport-api/src/kzn-bhamshela-identity.mjs','utf8');
const evidence=JSON.parse(fs.readFileSync('apps/transport-api/data/kzn-bhamshela-appelsbosch-identity-evidence.json','utf8'));
const server=fs.readFileSync('apps/transport-api/src/server.mjs','utf8');

const checks=[
  ['generic national identity resolver exists',/national_association_identity_resolution/.test(generic)],
  ['province is parameterized',/province=null/.test(generic)],
  ['fuzzy matching disabled',/fuzzyMatching:false/.test(generic)],
  ['deterministic variant review separated',/canonical_identity_variant_review/.test(generic)],
  ['exact canonical resolution supported',/canonical_identity_resolved_exact/.test(generic)],
  ['ambiguous exact identity fails closed',/canonical_identity_ambiguous/.test(generic)],
  ['new identity evidence-ready state supported',/canonical_identity_evidence_ready/.test(generic)],
  ['automatic canonical creation disabled',/automaticCanonicalCreation:false/.test(generic)],
  ['automatic alias promotion disabled',/automaticAliasPromotion:false/.test(generic)],
  ['rank-association evidence included',/rank_association_candidate/.test(generic)],
  ['linked route evidence included',/linkedRouteCodes/.test(generic)],
  ['Bhamshela exact authoritative label locked',evidence.label==='BHAMSHELA-APPELSBOSCH TAXI OWNERS ASS.'],
  ['historic establishment evidence present',evidence.evidence.some(x=>x.establishedDate==='1991-12-04')],
  ['multiple authoritative evidence dates',new Set(evidence.evidence.map(x=>x.documentDate)).size>=5],
  ['three blocked routes linked',evidence.linkedGazetteRouteCodes.length===3],
  ['KZN adapter uses generic resolver',/resolveAssociationIdentity/.test(kzn)],
  ['operator endpoint exposed',server.includes('coverage\\/kzn\\/bhamshela-identity')],
  ['operator endpoint authenticated',/national6IdentityMatch[\s\S]*operatorAuthOrSend/.test(server)],
  ['operator endpoint read only',/national6IdentityMatch[\s\S]*method!==['"]GET['"]/.test(server)]
];

const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log((ok?'PASS ':'FAIL ')+name);
if(failed.length){
  console.error('TN7_NATIONAL_6_STATIC_FAIL '+failed.length+'/'+checks.length);
  process.exit(1);
}
console.log('TN7_NATIONAL_6_STATIC_PASS '+checks.length+'/'+checks.length);
