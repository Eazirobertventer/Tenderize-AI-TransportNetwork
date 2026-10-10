import fs from 'node:fs';

const cache=fs.readFileSync('apps/kzn-licence-corpus-worker/artifact-cache.mjs','utf8');
const corpus=fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-8-corpus.mjs','utf8');
const pkg=JSON.parse(fs.readFileSync('apps/kzn-licence-corpus-worker/package.json','utf8'));

const checks=[
  ['cache has explicit enable switch',cache.includes("EVIDENCE_CACHE_ENABLED==='true'")],
  ['artifact keys are SHA256 content-addressed',cache.includes("'artifacts/sha256/'")],
  ['source URL pointers are deterministic',cache.includes("'sources/'") && cache.includes('sourceUrlHash')],
  ['immutable provenance manifests retained',cache.includes("'manifests/'") && cache.includes('provenanceManifestKey')],
  ['artifact checksum metadata persisted',cache.includes("sha256:checksum")],
  ['cache read verifies checksum',cache.includes('evidence_cache_checksum_mismatch')],
  ['cache checks existing artifact before write',cache.includes('objectExists')],
  ['worker loads cache before remote fetch',corpus.indexOf('loadCachedEvidenceArtifact')<corpus.indexOf('fetchWithPolicy(document.url')],
  ['worker persists successful remote artifact',corpus.includes('storeEvidenceArtifact')],
  ['worker identifies cache acquisition source',corpus.includes("source:'cache'")],
  ['worker identifies remote acquisition source',corpus.includes("source:'remote'")],
  ['parser/classifier DB transaction remains read only',corpus.includes("BEGIN READ ONLY")],
  ['canonical mutation remains disabled',corpus.includes('canonicalMutation:false')],
  ['automatic promotion remains disabled',corpus.includes('automaticPromotion:false')],
  ['S3 dependency declared',Boolean(pkg.dependencies?.['@aws-sdk/client-s3'])],
  ['cache module contains no taxi table writes',!/(INSERT\s+INTO\s+taxi_|UPDATE\s+taxi_|DELETE\s+FROM\s+taxi_)/i.test(cache)]
];

const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log((ok?'PASS ':'FAIL ')+name);
if(failed.length){
  console.error('TN7_NATIONAL_10_STATIC_FAIL '+failed.length+'/'+checks.length);
  process.exit(1);
}
console.log('TN7_NATIONAL_10_STATIC_PASS '+checks.length+'/'+checks.length);
