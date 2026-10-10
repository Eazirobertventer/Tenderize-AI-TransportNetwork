import fs from 'node:fs';

const manifest=JSON.parse(fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-8-sources.json','utf8'));
const framework=fs.readFileSync('apps/kzn-licence-corpus-worker/evidence-execution-framework.mjs','utf8');
const cache=fs.readFileSync('apps/kzn-licence-corpus-worker/artifact-cache.mjs','utf8');
const corpus=fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-8-corpus.mjs','utf8');

const seed=manifest.adapters.find(x=>x.id==='uthukela-kzn-provincial-gazette-2605');
const doc=seed?.documents?.[0];

const checks=[
  ['uThukela KZN Provincial Gazette seed configured',Boolean(seed)],
  ['seed uses static_documents adapter',seed?.adapterType==='static_documents'],
  ['seed issuing authority preserved',seed?.authority==='KwaZulu-Natal Provincial Gazette / Government Printing Works'],
  ['retrieval mirror explicit',seed?.retrievalMirror==='uThukela District Municipality'],
  ['seed source is HTTPS PDF',typeof doc?.url==='string' && /^https:\/\//.test(doc.url) && /\.pdf(?:\?|$)/i.test(doc.url)],
  ['framework carries retrieval mirror',framework.includes('retrievalMirror:adapter.retrievalMirror||null')],
  ['cache provenance stores retrieval mirror',cache.includes('retrievalMirror')],
  ['cache-only environment switch exists',corpus.includes("EVIDENCE_CACHE_ONLY==='true'")],
  ['cache-only miss blocks remote acquisition',corpus.includes('cache_miss_remote_disabled')],
  ['cache load precedes cache-only block',corpus.indexOf('loadCachedEvidenceArtifact')<corpus.indexOf('cache_miss_remote_disabled')],
  ['cache load precedes remote fetch',corpus.indexOf('loadCachedEvidenceArtifact')<corpus.indexOf('fetchWithPolicy(document.url')],
  ['remote success persists artifact',corpus.includes('storeEvidenceArtifact')],
  ['database classification remains read only',corpus.includes("BEGIN READ ONLY")],
  ['canonical mutation remains disabled',corpus.includes('canonicalMutation:false')],
  ['automatic promotion remains disabled',corpus.includes('automaticPromotion:false')]
];

const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log((ok?'PASS ':'FAIL ')+name);
if(failed.length){
  console.error('TN7_NATIONAL_11_STATIC_FAIL '+failed.length+'/'+checks.length);
  process.exit(1);
}
console.log('TN7_NATIONAL_11_STATIC_PASS '+checks.length+'/'+checks.length);
