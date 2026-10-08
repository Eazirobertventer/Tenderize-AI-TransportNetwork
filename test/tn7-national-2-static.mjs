import fs from 'node:fs';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const model=read('apps/transport-api/src/kzn-coverage.mjs');
const api=read('apps/transport-api/src/server.mjs');
const publicWeb=read('live/server.mjs');
const workbench=read('apps/transport-api/src/operator-workbench.mjs');
const operatorHtml=read('apps/operator-workbench/index.html');
const operatorJs=read('apps/operator-workbench/app.js');
const manifest=JSON.parse(read('apps/transport-api/data/kzn-verified-route-association-evidence.json'));

const checks=[
  ['KZN source execution mode',model.includes("mode:'kzn_source_execution'")],
  ['KZN province explicit',model.includes("province:'KwaZulu-Natal'")],
  ['canonical mutation disabled',model.includes('canonicalMutationEnabled:false')],
  ['spatial-only proof prohibited',model.includes('spatialProximityAloneIsProof:false')],
  ['exact route code required',model.includes('exactRouteCodeRequiredForVerifiedGazetteJoin:true')],
  ['unique association identity required',model.includes('uniqueAssociationIdentityRequiredForReadyBucket:true')],
  ['promotion requires adjudication',model.includes('promotionRequiresExistingAdjudicationWorkflow:true')],
  ['KZN rank inventory',model.includes("r.province='KwaZulu-Natal'")],
  ['ranks without association measured',model.includes('ranks_without_association')],
  ['route candidates measured',model.includes('route_candidates')],
  ['route candidates without association measured',model.includes('route_candidates_without_association')],
  ['endpoint evidence buckets',model.includes('no_association_evidence') && model.includes('origin_only') && model.includes('destination_only')],
  ['conflict bucket',model.includes('conflicting_or_multiple')],
  ['unique shared association bucket',model.includes('unique_shared_association')],
  ['verified gazette manifest packaged',Array.isArray(manifest) && manifest.length>0],
  ['verified rows include route code',manifest.every(x=>x.routeCode)],
  ['verified rows include association',manifest.every(x=>x.association)],
  ['verified rows include narrative',manifest.every(x=>x.rankNarrative)],
  ['verified rows include source URL',manifest.every(x=>x.sourceUrl)],
  ['canonical identity normalization',model.includes(".normalize('NFKC')")],
  ['exact candidate route code lookup',model.includes("lower(coalesce(rc.route_code,''))=ANY")],
  ['canonical route code lookup',model.includes("lower(coalesce(tr.source_route_code,''))=ANY")],
  ['association ambiguity fails review',model.includes("reason:'association_identity_ambiguous'")],
  ['association missing fails review',model.includes("reason:'association_not_canonical'")],
  ['candidate route ready bucket',model.includes("bucket:'route_candidate_evidence_ready'")],
  ['canonical route ready bucket',model.includes("bucket:'canonical_route_evidence_ready'")],
  ['canonical conflict review',model.includes("reason:'canonical_route_association_conflict'")],
  ['candidate conflict review',model.includes("reason:'route_candidate_association_conflict'")],
  ['unresolved bucket',model.includes("bucket:'unresolved'")],
  ['KZN execution API endpoint',api.includes("/api/v1/coverage/kzn/execution")],
  ['public KZN read-only proxy',publicWeb.includes("'/api/v1/coverage/kzn/execution'")],
  ['public Web remains GET HEAD only',publicWeb.includes("if(!['GET','HEAD'].includes(req.method || 'GET'))")],
  ['operator workbench embeds KZN model',workbench.includes('kznExecution')],
  ['operator KZN execution panel',operatorHtml.includes('id="kznExecutionList"')],
  ['operator KZN route bucket UI',operatorJs.includes('kznBucketGrid')],
  ['operator KZN evidence row UI',operatorJs.includes('verifiedGazette')],
  ['no write SQL in KZN model',!/(INSERT\s+INTO|UPDATE\s+taxi_|DELETE\s+FROM|ALTER\s+TABLE)/i.test(model)]
];

for(const [name,ok] of checks){
  if(!ok) throw new Error('TN7_NATIONAL_2_STATIC_FAIL: '+name);
  console.log('PASS '+name);
}
console.log('TN7_NATIONAL_2_STATIC_PASS '+checks.length+'/'+checks.length);
