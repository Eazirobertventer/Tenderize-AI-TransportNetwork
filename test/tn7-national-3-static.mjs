import fs from 'node:fs';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const queue=read('apps/transport-api/src/kzn-gazette-queue.mjs');
const api=read('apps/transport-api/src/server.mjs');
const publicWeb=read('live/server.mjs');
const workbench=read('apps/transport-api/src/operator-workbench.mjs');
const operatorHtml=read('apps/operator-workbench/index.html');
const operatorJs=read('apps/operator-workbench/app.js');
const corpus=read('apps/kzn-licence-corpus-worker/tn7-national-3-corpus.mjs');
const sources=JSON.parse(read('apps/kzn-licence-corpus-worker/tn7-national-3-sources.json'));
const indexed=JSON.parse(read('apps/transport-api/data/kzn-national-3-indexed-gazette-evidence.json'));
const seed=JSON.parse(read('apps/transport-api/data/kzn-verified-route-association-evidence.json'));

const checks=[
 ['expansion source manifest has 13 documents',sources.length===13],
 ['expansion manifest uses gazette mirrors',sources.every(x=>/saflii\.org/.test(x.url) && /Provincial Gazette/.test(x.authority))],
 ['corpus executor is read only',corpus.includes("await client.query('BEGIN READ ONLY')")],
 ['corpus executor bounded to 250',corpus.includes('const boundedQueue=queue.slice(0,250)')],
 ['corpus direct fetch failure is isolated per document',corpus.includes('failures.push')],
 ['corpus result server read only',corpus.includes("url.pathname==='/summary'") && corpus.includes("url.pathname==='/queue'")],
 ['indexed expansion contains 8 rows',indexed.length===8],
 ['indexed expansion rows have route code',indexed.every(x=>x.routeCode)],
 ['indexed expansion rows have association label',indexed.every(x=>x.association)],
 ['indexed expansion rows preserve source URL',indexed.every(x=>x.sourceUrl)],
 ['original verified seed remains 11 rows',seed.length===11],
 ['queue combines seed and indexed evidence',queue.includes('const evidence=[...seed,...indexed]')],
 ['queue mode explicit',queue.includes("mode:'kzn_gazette_evidence_queue'")],
 ['canonical mutation disabled',queue.includes('canonicalMutationEnabled:false')],
 ['automatic promotion disabled',queue.includes('automaticPromotionEnabled:false')],
 ['exact route code required',queue.includes('exactRouteCodeRequired:true')],
 ['unique canonical association required',queue.includes('uniqueCanonicalAssociationRequiredForReady:true')],
 ['indexed rows still require operator review',queue.includes('indexedEvidenceMustStillBeOperatorReviewed:true')],
 ['promotion routes through ADJ5 ADJ6',queue.includes("promotionRoute:'existing_ADJ5_ADJ6_workflows'")],
 ['association NFKC normalization',queue.includes(".normalize('NFKC')")],
 ['candidate route exact index',queue.includes('candidateIndex.get(normalize(item.routeCode))')],
 ['canonical route exact index',queue.includes('canonicalIndex.get(normalize(item.routeCode))')],
 ['association ambiguity review bucket',queue.includes("reason:'association_identity_ambiguous'")],
 ['association identity pending bucket',queue.includes("bucket:'association_identity_pending'")],
 ['route candidate ready bucket',queue.includes("bucket:'route_candidate_evidence_ready'")],
 ['canonical route ready bucket',queue.includes("bucket:'canonical_route_evidence_ready'")],
 ['missing route code retained as evidence',queue.includes("bucket:'route_code_not_in_candidate_corpus'")],
 ['adjudication required flag',queue.includes('adjudicationRequired')],
 ['bounded API limit 250',queue.includes('Math.min(Math.max(Number(limit)||250,1),250)')],
 ['direct PDF block is explicit source availability',queue.includes("failureClass:'remote_http_access_blocked'")],
 ['gazette queue API endpoint',api.includes("/api/v1/coverage/kzn/gazette-queue")],
 ['public gazette queue allowlist',publicWeb.includes("'/api/v1/coverage/kzn/gazette-queue'")],
 ['public web remains GET HEAD only',publicWeb.includes("if(!['GET','HEAD'].includes(req.method || 'GET'))")],
 ['operator workbench embeds queue',workbench.includes('kznGazetteQueue')],
 ['operator NATIONAL-3 panel',operatorHtml.includes('id="kznGazetteQueueList"')],
 ['operator queue renders bucket counts',operatorJs.includes('kznGazetteBucketGrid')],
 ['operator queue renders evidence rows',operatorJs.includes('kznGazetteQueueList')],
 ['no write SQL in queue model',!/(INSERT\s+INTO|UPDATE\s+taxi_|DELETE\s+FROM|ALTER\s+TABLE)/i.test(queue)]
];

for(const [name,ok] of checks){
  if(!ok) throw new Error('TN7_NATIONAL_3_STATIC_FAIL: '+name);
  console.log('PASS '+name);
}
console.log('TN7_NATIONAL_3_STATIC_PASS '+checks.length+'/'+checks.length);
