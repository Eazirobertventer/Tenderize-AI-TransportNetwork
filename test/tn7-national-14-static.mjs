import fs from 'node:fs';

const resolver=fs.readFileSync('apps/kzn-licence-corpus-worker/kzn-multi-date-identity-resolution.mjs','utf8');
const canonical=fs.readFileSync('apps/transport-api/src/association-identity-resolution.mjs','utf8');
const corpus=fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-8-corpus.mjs','utf8');

const checks=[
 ['reuses canonical identity resolver',resolver.includes("resolveAssociationIdentity")],
 ['only targets controlled identity review cases',resolver.includes("controlled_association_identity_review")],
 ['passes KZN province scope',resolver.includes("province:'KwaZulu-Natal'")],
 ['passes authoritative multi-date evidence',resolver.includes("provincial_operating_licence_gazette")],
 ['passes linked route codes',resolver.includes('linkedRouteCodes')],
 ['exact match outcome supported',resolver.includes("state:'exact_canonical_match'")],
 ['deterministic alias review supported',resolver.includes("state:'deterministic_alias_review'")],
 ['canonical creation candidate supported',resolver.includes("state:'canonical_creation_candidate'")],
 ['manual hold supported',resolver.includes("state:'manual_hold'")],
 ['no proposal creation in NATIONAL-14',resolver.includes('proposalCreated:false')],
 ['no automatic approval',resolver.includes('automaticApproval:false')],
 ['no canonical mutation',resolver.includes('canonicalMutation:false')],
 ['canonical resolver fuzzy matching disabled',canonical.includes('fuzzyMatching:false')],
 ['canonical resolver automatic creation disabled',canonical.includes('automaticCanonicalCreation:false')],
 ['canonical resolver automatic alias promotion disabled',canonical.includes('automaticAliasPromotion:false')],
 ['corpus runs resolver before rollback',corpus.indexOf('resolveMultiDateAssociationCases')<corpus.indexOf("client.query('ROLLBACK')")],
 ['identity resolution endpoint exposed',corpus.includes("url.pathname==='/identity-resolution'")],
 ['corpus transaction remains read only',corpus.includes("BEGIN READ ONLY")]
];

const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log((ok?'PASS ':'FAIL ')+name);
if(failed.length){
  console.error('TN7_NATIONAL_14_STATIC_FAIL '+failed.length+'/'+checks.length);
  process.exit(1);
}
console.log('TN7_NATIONAL_14_STATIC_PASS '+checks.length+'/'+checks.length);
