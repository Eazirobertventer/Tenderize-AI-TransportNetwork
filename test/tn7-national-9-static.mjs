import fs from 'node:fs';

const manifest=JSON.parse(fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-8-sources.json','utf8'));
const framework=fs.readFileSync('apps/kzn-licence-corpus-worker/evidence-execution-framework.mjs','utf8');
const corpus=fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-8-corpus.mjs','utf8');

const official=manifest.adapters.find(x=>x.id==='kzn-dot-operating-licence-2025-official');
const saflii=manifest.adapters.filter(x=>x.id.startsWith('saflii-kzn-gazette-'));

const checks=[
  ['official KZN DOT runtime adapter present',Boolean(official)],
  ['official adapter is static_documents',official?.adapterType==='static_documents'],
  ['official adapter contains at least four documents',(official?.documents||[]).length>=4],
  ['official documents are kzntransport.gov.za',(official?.documents||[]).every(x=>/^https:\/\/www\.kzntransport\.gov\.za\//.test(x.url))],
  ['SAFLII mirror adapters preserved',saflii.length>=15],
  ['static adapter supported generically',framework.includes("adapter.adapterType==='static_documents'")],
  ['runtime still begins read only',corpus.includes("BEGIN READ ONLY")],
  ['runtime still prohibits canonical mutation',corpus.includes('canonicalMutation:false')],
  ['runtime still prohibits automatic promotion',corpus.includes('automaticPromotion:false')],
  ['runtime keeps per-document failures isolated',corpus.includes("parse_failed:")],
  ['runtime emits source checksums',corpus.includes('checksum')],
  ['runtime queue remains bounded',corpus.includes('maximumQueueItems')]
];

const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log((ok?'PASS ':'FAIL ')+name);
if(failed.length){
  console.error('TN7_NATIONAL_9_STATIC_FAIL '+failed.length+'/'+checks.length);
  process.exit(1);
}
console.log('TN7_NATIONAL_9_STATIC_PASS '+checks.length+'/'+checks.length);
