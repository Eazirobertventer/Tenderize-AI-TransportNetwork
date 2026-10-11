import fs from 'node:fs';

const src=fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-27-authoritative-feature-execution.mjs','utf8');
const wf=fs.readFileSync('.github/workflows/tn7-national-27-r1.yml','utf8');

const checks=[
  ['fixed official host retained',src.includes("const OFFICIAL_HOST='gis.kznpidh.gov.za'")],
  ['Node strict TLS remains primary',src.includes("transport:'node_fetch_strict_tls'")],
  ['curl strict TLS fallback present',src.includes("transport:'curl_strict_tls'")],
  ['curl limited to https',src.includes("'--proto','=https'")],
  ['redirect following absent',!src.includes("'--location'") && !src.includes("redirect:'follow'")],
  ['TLS bypass absent',!src.includes('NODE_TLS_REJECT_UNAUTHORIZED') && !src.includes('rejectUnauthorized:false') && !src.includes("'--insecure'")],
  ['failure cause chain captured',src.includes('function errorChain(error)')],
  ['both transport attempts reported',src.includes("transportAttempts:['node_fetch_strict_tls','curl_strict_tls']")],
  ['source responses checksummed',src.includes('checksum(buffer)')],
  ['response size remains bounded',src.includes('MAX_BYTES=8*1024*1024')],
  ['stderr captured into runtime artifact',wf.includes('2>&1 | tee national27-r1-result.log')],
  ['PIPESTATUS preserves executor status',wf.includes('PIPESTATUS[0]')],
  ['blocked state explicitly classified',wf.includes('TN7_NATIONAL_27_R1_RUNTIME_BLOCKED_BY_SOURCE')],
  ['pass state explicitly classified',wf.includes('TN7_NATIONAL_27_R1_RUNTIME_PASS')],
  ['unclassified state fails',wf.includes('TN7_NATIONAL_27_R1_RUNTIME_UNCLASSIFIED')],
  ['artifact always uploaded',wf.includes('if: always()')],
  ['canonical mutation remains disabled',src.includes('canonicalMutation:false')],
  ['automatic rank creation remains disabled',src.includes('automaticRankCreation:false')],
  ['automatic route creation remains disabled',src.includes('automaticRouteCandidateCreation:false')]
];

const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log((ok?'PASS ':'FAIL ')+name);
if(failed.length){
  console.error('TN7_NATIONAL_27_R1_STATIC_FAIL '+failed.length+'/'+checks.length);
  process.exit(1);
}
console.log('TN7_NATIONAL_27_R1_STATIC_PASS '+checks.length+'/'+checks.length);
