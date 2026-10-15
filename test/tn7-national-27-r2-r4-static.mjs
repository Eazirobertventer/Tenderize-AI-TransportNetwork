import fs from 'node:fs';

const manifest=JSON.parse(fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-27-r2-r4-crosswalk.json','utf8'));
const src=fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-27-r2-r4-crosswalk.mjs','utf8');
const wf=fs.readFileSync('.github/workflows/tn7-national-27-r2-r4.yml','utf8');

const checks=[
  ['R3 source head locked',manifest.sourceGate.head==='5419c25c62235c6337823751ab211095a293230f'],
  ['P748 length banked',manifest.documentaryCrosswalk.P748.lengthKm===10.49],
  ['P748 provincial class banked',manifest.documentaryCrosswalk.P748.roadClass==='provincial'],
  ['L2887 local class banked',manifest.documentaryCrosswalk.L2887.roadClass==='local'],
  ['L2887 off R22 evidence banked',manifest.documentaryCrosswalk.L2887.topology.includes('off_R22')],
  ['D234 spatial crosswalk remains pending',manifest.documentaryCrosswalk.D234.identityState==='gazette_route_identity_confirmed_spatial_crosswalk_pending'],
  ['known different road code is hard exclusion',manifest.policy.knownDifferentRoadCodeIsHardExclusion===true],
  ['topology alone cannot rename road',manifest.policy.topologyAloneCannotRenameRoad===true],
  ['resolver uses official HTTPS host',src.includes("u.protocol!=='https:'")],
  ['resolver rejects redirects',src.includes("redirect:'error'")],
  ['TLS bypass absent',!src.includes('NODE_TLS_REJECT_UNAUTHORIZED')&&!src.includes('rejectUnauthorized:false')&&!src.includes('--insecure')],
  ['P748 different provincial codes rejected',src.includes('known_different_provincial_code')],
  ['P748 different class codes rejected',src.includes('known_different_road_class_code')],
  ['L2887 different local codes rejected',src.includes('known_different_local_code')],
  ['R3 candidate IDs revalidated against source',src.includes('r3_candidate_feature_missing')],
  ['no topology renaming marker retained',src.includes('noCandidateRenamedByTopology:true')],
  ['automatic road promotion disabled',src.includes('automaticRoadIdentityPromotion:false')],
  ['route candidate creation disabled',src.includes('automaticRouteCandidateCreation:false')],
  ['canonical mutation disabled',src.includes('canonicalMutation:false')],
  ['workflow emits READY state',wf.includes('TN7_NATIONAL_27_R2_R4_RUNTIME_READY')],
  ['workflow emits HOLD state',wf.includes('TN7_NATIONAL_27_R2_R4_RUNTIME_HOLD')],
  ['workflow uploads R4 evidence',wf.includes('tn7-national-27-r2-r4-evidence')]
];

const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log((ok?'PASS ':'FAIL ')+name);
if(failed.length){
  console.error('TN7_NATIONAL_27_R2_R4_STATIC_FAIL '+failed.length+'/'+checks.length);
  process.exit(1);
}
console.log('TN7_NATIONAL_27_R2_R4_STATIC_PASS '+checks.length+'/'+checks.length);
