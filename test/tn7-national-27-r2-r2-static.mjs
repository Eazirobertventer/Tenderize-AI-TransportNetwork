import fs from 'node:fs';

const manifest=JSON.parse(fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-27-r2-r2-manifest.json','utf8'));
const src=fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-27-r2-r2-recovery.mjs','utf8');
const wf=fs.readFileSync('.github/workflows/tn7-national-27-r2-r2.yml','utf8');

const checks=[
  ['Gluckstadt NDoH anchor banked',manifest.gluckstadt.officialAnchor.name==='Gluckstadt Clinic' && manifest.gluckstadt.officialAnchor.latitude===-27.97413 && manifest.gluckstadt.officialAnchor.longitude===31.039209],
  ['Gluckstadt P219 corridor evidence banked',/P219/i.test(manifest.gluckstadt.corridorEvidence.detail)],
  ['two COGTA candidates banked',manifest.gluckstadt.candidateCentroids.length===2],
  ['nearest-only selection disabled',manifest.policy.candidateSelectionByNearestOnly===false],
  ['candidate rejection threshold bounded',manifest.gluckstadt.candidateRejectionThresholdMetres===10000],
  ['Mbazwana NDoH anchor banked',manifest.mbazwana.officialAnchor.name==='Mbazwana Clinic'],
  ['D234 evidence retained',Boolean(manifest.mbazwana.roadEvidence.D234)],
  ['P748 evidence retained',Boolean(manifest.mbazwana.roadEvidence.P748)],
  ['L2887 evidence retained',Boolean(manifest.mbazwana.roadEvidence.L2887)],
  ['official COGTA road source locked',manifest.mbazwana.spatialRecovery.host==='giswebmaps1.kzncogta.gov.za'],
  ['bounded road window configured',manifest.mbazwana.spatialRecovery.bbox4326.xmin===32.28 && manifest.mbazwana.spatialRecovery.bbox4326.xmax===32.82],
  ['runtime enforces HTTPS',src.includes("u.protocol!=='https:'")],
  ['runtime rejects redirects',src.includes("redirect:'error'")],
  ['TLS bypass absent',!src.includes('NODE_TLS_REJECT_UNAUTHORIZED')&&!src.includes('rejectUnauthorized:false')&&!src.includes('--insecure')],
  ['responses checksummed',src.includes("createHash('sha256')")],
  ['Gluckstadt candidates measured to official anchor',src.includes('distanceToOfficialAnchorMetres')],
  ['false candidates can be rejected',src.includes('bothCogtaCandidatesRejected')],
  ['exact taxi rank coordinate remains unrecovered',src.includes('exactTaxiRankCoordinateRecovered:false')],
  ['spatial road window acquired',src.includes('esriGeometryEnvelope') && src.includes('esriSpatialRelIntersects')],
  ['literal road identity remains explicit',src.includes('literalMatchCounts')],
  ['anonymous geometry promotion disabled',manifest.policy.anonymousGeometryPromotion===false],
  ['route candidate creation disabled',src.includes('automaticRouteCandidateCreation:false')],
  ['rank creation disabled',src.includes('automaticRankCreation:false')],
  ['canonical mutation disabled',src.includes('canonicalMutation:false')],
  ['workflow uploads R2-R2 evidence',wf.includes('tn7-national-27-r2-r2-evidence')],
  ['workflow distinguishes road identity pending',wf.includes('TN7_NATIONAL_27_R2_R2_RUNTIME_PARTIAL')],
  ['workflow distinguishes readiness',wf.includes('TN7_NATIONAL_27_R2_R2_RUNTIME_READY')],
  ['R22 remains required control road',src.includes("['D234','P748','R22','L2887']")]
];

const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log((ok?'PASS ':'FAIL ')+name);
if(failed.length){
  console.error('TN7_NATIONAL_27_R2_R2_STATIC_FAIL '+failed.length+'/'+checks.length);
  process.exit(1);
}
console.log('TN7_NATIONAL_27_R2_R2_STATIC_PASS '+checks.length+'/'+checks.length);
