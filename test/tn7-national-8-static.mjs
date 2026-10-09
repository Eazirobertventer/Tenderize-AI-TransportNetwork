import fs from 'node:fs';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const framework=read('apps/kzn-licence-corpus-worker/evidence-execution-framework.mjs');
const corpus=read('apps/kzn-licence-corpus-worker/tn7-national-8-corpus.mjs');
const manifest=JSON.parse(read('apps/kzn-licence-corpus-worker/tn7-national-8-sources.json'));
const plan=read('apps/transport-api/src/kzn-corpus-plan.mjs');
const server=read('apps/transport-api/src/server.mjs');
const pkg=JSON.parse(read('apps/kzn-licence-corpus-worker/package.json'));

const years=manifest.adapters.map(x=>Number((x.id.match(/(20\d{2})$/)||[])[1])).filter(Boolean);

const checks=[
  ['generic evidence framework exists',/discoverAdapterDocuments/.test(framework)],
  ['authoritative static document adapters supported',/static_documents/.test(framework)],
  ['generic normalisation exists',/normalizeEvidenceRows/.test(framework)],
  ['SHA256 provenance checksum exists',/sha256Buffer/.test(framework)],
  ['index discovery parses PDF links',/discoverDocumentLinks/.test(framework)],
  ['bounded document fetch size',/maxBytes/.test(framework)],
  ['retry policy exists',/retries/.test(framework)],
  ['manifest is KZN adapter configuration',manifest.province==='KwaZulu-Natal'],
  ['manifest covers at least 15 years',new Set(years).size>=15],
  ['manifest includes 2026',years.includes(2026)],
  ['manifest execution is read only',manifest.executionMode==='read_only_evidence'],
  ['manifest caps documents at 500',manifest.maximumDocumentsPerRun===500],
  ['manifest caps queue at 1000',manifest.maximumQueueItems===1000],
  ['adapters use supported discovery modes',manifest.adapters.every(x=>x.adapterType==='html_pdf_index' || x.adapterType==='static_documents')],
  ['index adapters use HTTPS index URLs',manifest.adapters.filter(x=>x.adapterType==='html_pdf_index').every(x=>/^https:\/\//.test(x.indexUrl))],
  ['static adapters use HTTPS document URLs',manifest.adapters.filter(x=>x.adapterType==='static_documents').every(x=>(x.documents||[]).length>0 && x.documents.every(d=>/^https:\/\//.test(d.url)))],
  ['corpus uses BEGIN READ ONLY',corpus.includes("BEGIN READ ONLY")],
  ['corpus deduplicates discovered docs',/dedupeDocuments/.test(corpus)],
  ['corpus uses bounded concurrency',/mapLimit/.test(corpus)],
  ['corpus checksums each fetched document',/checksum/.test(corpus)],
  ['corpus normalizes evidence rows',/normalizeEvidenceRows/.test(corpus)],
  ['corpus classifies evidence',/classifyEvidenceRow/.test(corpus)],
  ['corpus no automatic promotion',/automaticPromotion:false/.test(corpus)],
  ['corpus no canonical mutation',/canonicalMutation:false/.test(corpus)],
  ['corpus exposes bounded queue endpoint',/url\.pathname==='\/queue'/.test(corpus)],
  ['corpus exposes document provenance endpoint',/url\.pathname==='\/documents'/.test(corpus)],
  ['transport API corpus plan is read only',/mutationEnabled:false/.test(plan)],
  ['national framework intent explicit',/genericDiscovery:true/.test(plan) && /provinceSpecificParser:true/.test(plan)],
  ['operator corpus-plan endpoint exists',server.includes('coverage\\/kzn\\/corpus-plan')],
  ['operator corpus-plan endpoint authenticated',/national8CorpusPlanMatch[\s\S]*operatorAuthOrSend/.test(server)],
  ['worker package exposes national8 script',pkg.scripts?.national8==='node tn7-national-8-corpus.mjs'],
  ['framework contains no database writes',!/(INSERT\s+INTO|UPDATE\s+taxi_|DELETE\s+FROM|ALTER\s+TABLE)/i.test(framework)],
  ['corpus contains no canonical write SQL',!/(INSERT\s+INTO\s+taxi_|UPDATE\s+taxi_|DELETE\s+FROM\s+taxi_)/i.test(corpus)]
];

const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log((ok?'PASS ':'FAIL ')+name);
if(failed.length){
  console.error('TN7_NATIONAL_8_STATIC_FAIL '+failed.length+'/'+checks.length);
  process.exit(1);
}
console.log('TN7_NATIONAL_8_STATIC_PASS '+checks.length+'/'+checks.length);
