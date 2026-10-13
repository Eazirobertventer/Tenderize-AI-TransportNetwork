import fs from 'node:fs';

const manifest=JSON.parse(fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-27-r2-source-manifest.json','utf8'));
const acquire=fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-27-r2-acquire-cache.mjs','utf8');
const offline=fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-27-r2-offline-reconcile.mjs','utf8');
const wf=fs.readFileSync('.github/workflows/tn7-national-27-r2.yml','utf8');

const checks=[
  ['official COGTA host locked',manifest.sources.gluckstadt.host==='giswebmaps1.kzncogta.gov.za' && manifest.sources.roads.host==='giswebmaps1.kzncogta.gov.za'],
  ['Abaqulusi Bus and Taxi Rank source configured',manifest.sources.gluckstadt.query.where==="LUS_ZONING='Bus and Taxi Rank'"],
  ['KZN road network source configured',manifest.sources.roads.layerName==='KZN road network (2021)'],
  ['four roads required',JSON.stringify(manifest.sources.roads.requiredRoads)===JSON.stringify(['D234','P748','R22','L2887'])],
  ['official sources only policy',manifest.policy.officialSourcesOnly===true],
  ['canonical mutation disabled',manifest.policy.canonicalMutation===false],
  ['TLS bypass disabled',manifest.policy.tlsVerificationBypassed===false],
  ['acquisition enforces https',acquire.includes("parsed.protocol!=='https:'")],
  ['acquisition rejects redirects',acquire.includes("redirect:'error'")],
  ['acquisition has no TLS bypass',!acquire.includes('NODE_TLS_REJECT_UNAUTHORIZED')&&!acquire.includes('rejectUnauthorized:false')&&!acquire.includes('--insecure')],
  ['acquisition response bounded',acquire.includes('MAX_BYTES=16*1024*1024')],
  ['acquisition checksums artifacts',acquire.includes("createHash('sha256')")],
  ['cache manifest records authority',acquire.includes('authority:rankSource.authority')&&acquire.includes('authority:roadSource.authority')],
  ['offline reconciliation verifies checksums',offline.includes('cache_checksum_mismatch')],
  ['offline reconciliation does not fetch remote data',!offline.includes('fetch(')],
  ['offline Gluckstadt reconciliation explicit',offline.includes('exactUniqueControlCandidateRecovered')],
  ['offline road topology explicit',offline.includes('p748ToR22MinVertexDistanceMetres')&&offline.includes('r22ToL2887MinVertexDistanceMetres')],
  ['rank creation disabled',offline.includes('automaticRankCreation:false')],
  ['route candidate creation disabled',offline.includes('automaticRouteCandidateCreation:false')],
  ['workflow runs cache before offline reconcile',wf.indexOf('Acquire official datasets')<wf.indexOf('Offline reconciliation')],
  ['workflow captures cache artifact',wf.includes('tn7-national-27-r2-official-cache')],
  ['workflow captures reconciliation result',wf.includes('tn7-national-27-r2-reconciliation')],
  ['workflow classifies ready state',wf.includes('TN7_NATIONAL_27_R2_RUNTIME_READY')],
  ['workflow classifies partial state',wf.includes('TN7_NATIONAL_27_R2_RUNTIME_PARTIAL')]
];

const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log((ok?'PASS ':'FAIL ')+name);
if(failed.length){
  console.error('TN7_NATIONAL_27_R2_STATIC_FAIL '+failed.length+'/'+checks.length);
  process.exit(1);
}
console.log('TN7_NATIONAL_27_R2_STATIC_PASS '+checks.length+'/'+checks.length);
