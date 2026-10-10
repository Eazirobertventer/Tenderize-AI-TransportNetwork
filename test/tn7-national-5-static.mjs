import fs from 'node:fs';

const generic=fs.readFileSync('apps/transport-api/src/route-evidence-gap-recovery.mjs','utf8');
const kzn=fs.readFileSync('apps/transport-api/src/kzn-route-gap-recovery.mjs','utf8');
const server=fs.readFileSync('apps/transport-api/src/server.mjs','utf8');

const checks=[
  ['generic national recovery engine exists',/national_route_evidence_gap_recovery/.test(generic)],
  ['province is parameterized',/province/.test(generic) && !/province='KwaZulu-Natal'/.test(generic)],
  ['NFKC normalization',/normalize\('NFKC'\)/.test(generic)],
  ['numeric padding preserved',/numericPaddingPreserved:true/.test(generic)],
  ['fuzzy matching disabled',/fuzzyMatching:false/.test(generic)],
  ['source geometry searched',/FROM source_route_geometry/.test(generic)],
  ['candidate identifiers searched',/external_record_id/.test(generic)],
  ['source records searched',/FROM source_record/.test(generic)],
  ['candidate generation gap explicit',/candidate_generation_gap/.test(generic)],
  ['alternate identifier explicit',/alternate_candidate_identifier/.test(generic)],
  ['payload-only evidence explicit',/payload_reference_only/.test(generic)],
  ['no automatic candidate creation',/automaticCandidateCreationEnabled:false/.test(generic)],
  ['no canonical mutation',/canonicalMutationEnabled:false/.test(generic)],
  ['KZN wrapper consumes NATIONAL-3 queue',/loadKznGazetteEvidenceQueue/.test(kzn)],
  ['only missing route-code bucket selected',/route_code_not_in_candidate_corpus/.test(kzn)],
  ['KZN expected gap is three',/expectedGapRows:3/.test(kzn)],
  ['operator endpoint exposed',server.includes('coverage\\/kzn\\/route-gap-recovery')],
  ['operator endpoint requires auth',/national5GapRecoveryMatch[\s\S]*operatorAuthOrSend/.test(server)],
  ['operator endpoint read only',/national5GapRecoveryMatch[\s\S]*method!==['"]GET['"]/.test(server)]
];

const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log((ok?'PASS ':'FAIL ')+name);
if(failed.length){
  console.error('TN7_NATIONAL_5_STATIC_FAIL '+failed.length+'/'+checks.length);
  process.exit(1);
}
console.log('TN7_NATIONAL_5_STATIC_PASS '+checks.length+'/'+checks.length);
