import fs from 'node:fs';

const manifest=JSON.parse(fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-27-r2-r6-legacy-register.json','utf8'));
const src=fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-27-r2-r6-legacy-recovery.mjs','utf8');
const wf=fs.readFileSync('.github/workflows/tn7-national-27-r2-r6.yml','utf8');

const checks=[
  ['R5 source head locked',manifest.sourceGate.head==='002903592246f6e15659335202da5195f695cb90'],
  ['P748 crossing sequence banked',manifest.legacyEvidence.P748.some(x=>/crosses R22/i.test(x.detail))),
  ['P748 length evidence banked',manifest.legacyEvidence.P748.some(x=>/10\.49 km/i.test(x.detail))),
  ['L2887 municipal recurrence banked',manifest.legacyEvidence.L2887.length>=2],
  ['D234 recurrent gazette evidence banked',manifest.legacyEvidence.D234.length>=2],
  ['legacy GIS repository banked',manifest.legacyEvidence.legacyGisRepository.authority==='KwaZulu-Natal Department of Transport'],
  ['legacy public export remains unresolved',manifest.legacyEvidence.legacyGisRepository.publicFeatureExportLocated===false],
  ['legacy alias must be explicit',manifest.policy.legacyAliasMustBeExplicit===true],
  ['geometric continuation only narrows',manifest.policy.geometricContinuationCanOnlyNarrowCandidates===true],
  ['resolver uses official HTTPS source',src.includes("u.protocol!=='https:'")],
  ['resolver rejects redirects',src.includes("redirect:'error'")],
  ['TLS bypass absent',!src.includes('NODE_TLS_REJECT_UNAUTHORIZED')&&!src.includes('rejectUnauthorized:false')&&!src.includes('--insecure')],
  ['R22 control required',src.includes('r22_control_missing')],
  ['P447 control required',src.includes('p447_control_missing')],
  ['P447/R22 crossing recovered',src.includes('p447_r22_crossing_not_found')],
  ['crossing candidate radius bounded',src.includes('candidateSearchRadiusMetres')],
  ['P748 explicit alias checked',src.includes("exactLegacyAlias(x.feature,'P748')")],
  ['L2887 OLD_STR/ROAD_ID rechecked',src.includes("explicitL2887Alias:exactLegacyAlias(pseudo,'L2887')")],
  ['D234 legacy export explicitly held',src.includes('legacy_kzn_dot_plan_or_register_export_required')],
  ['no geometric candidate promotion',src.includes('noGeometricCandidatePromotedWithoutAlias:true')],
  ['automatic road promotion disabled',src.includes('automaticRoadIdentityPromotion:false')],
  ['route candidate creation disabled',src.includes('automaticRouteCandidateCreation:false')],
  ['canonical mutation disabled',src.includes('canonicalMutation:false')],
  ['workflow emits READY',wf.includes('TN7_NATIONAL_27_R2_R6_RUNTIME_READY')],
  ['workflow emits HOLD',wf.includes('TN7_NATIONAL_27_R2_R6_RUNTIME_HOLD')],
  ['workflow uploads evidence',wf.includes('tn7-national-27-r2-r6-evidence')]
];

const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log((ok?'PASS ':'FAIL ')+name);
if(failed.length){
  console.error('TN7_NATIONAL_27_R2_R6_STATIC_FAIL '+failed.length+'/'+checks.length);
  process.exit(1);
}
console.log('TN7_NATIONAL_27_R2_R6_STATIC_PASS '+checks.length+'/'+checks.length);
