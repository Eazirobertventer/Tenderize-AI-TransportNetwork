import fs from 'node:fs';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const national=read('apps/transport-api/src/national-coverage.mjs');
const api=read('apps/transport-api/src/server.mjs');
const workbench=read('apps/transport-api/src/operator-workbench.mjs');
const operatorHtml=read('apps/operator-workbench/index.html');
const operatorJs=read('apps/operator-workbench/app.js');
const publicServer=read('live/server.mjs');
const publicHtml=read('live/index.html');
const publicJs=read('live/app.js');

const provinces=[
 'Gauteng','KwaZulu-Natal','Western Cape','Eastern Cape','Free State',
 'Limpopo','Mpumalanga','North West','Northern Cape'
];

const checks=[
 ['all nine provinces named',provinces.every(p=>national.includes("'"+p+"'"))],
 ['national gap model mode',national.includes("mode:'coverage_gap_model'")],
 ['canonical mutation explicitly disabled',national.includes('canonicalMutationEnabled:false')],
 ['priority disclaimer present',national.includes('not canonical confidence or evidence truth')],
 ['priority includes location gaps',national.includes('locationGap*3')],
 ['priority includes association gaps',national.includes('associationGap*4')],
 ['priority includes route gaps',national.includes('routeEndpointGap*2')],
 ['evidence opportunity bounded',national.includes('Math.min(1.35')],
 ['completeness uses coordinate and association coverage',national.includes('coordinateRate*0.5') && national.includes('associationRate*0.5')],
 ['province ranks measured',national.includes('location_pending_ranks')],
 ['unassociated ranks measured',national.includes('ranks_without_association')],
 ['active issues measured',national.includes('active_issues')],
 ['rank association candidates measured',national.includes('rank_association_candidates')],
 ['route candidates without association measured',national.includes('route_candidates_without_association')],
 ['canonical routes without association measured',national.includes('canonical_routes_without_association')],
 ['unresolved route endpoints measured',national.includes('routes_with_unresolved_endpoints')],
 ['official source opportunity measured',national.includes('official_source_records')],
 ['documented source opportunity measured',national.includes('documented_source_records')],
 ['municipality drill down exists',national.includes('municipalities=result.rows.map')],
 ['gap feature collection exists',national.includes("type:'FeatureCollection'")],
 ['gap mapped ranks only',national.includes('r.location IS NOT NULL')],
 ['missing association gap class',national.includes("'missing_association'")],
 ['active issue gap class',national.includes("'active_issue'")],
 ['association candidate gap class',national.includes("'association_candidate'")],
 ['national coverage endpoint',api.includes("/api/v1/coverage/national")],
 ['coverage gaps endpoint',api.includes("/api/v1/coverage/gaps")],
 ['operator workbench embeds coverage',workbench.includes('coverage:nationalCoverage')],
 ['operator coverage navigation',operatorHtml.includes('data-view="coverage"')],
 ['operator province priority UI',operatorJs.includes('coverageProvinceList')],
 ['public allowlist national coverage',publicServer.includes("'/api/v1/coverage/national'")],
 ['public allowlist gap layer',publicServer.includes("'/api/v1/coverage/gaps'")],
 ['public web remains read-only',publicServer.includes("if(!['GET','HEAD'].includes(req.method || 'GET'))")],
 ['map coverage gap toggle',publicHtml.includes('id="coverageGapToggle"')],
 ['map gap source',publicJs.includes("map.addSource('coverage-gaps'")],
 ['map gap point layer',publicJs.includes("id:'coverage-gap-points'")],
 ['map gap loader',publicJs.includes('async function loadCoverageGaps()')],
 ['map gap click drill down',publicJs.includes("map.on('click','coverage-gap-points'")],
 ['no new write SQL in coverage module',!/(INSERT\s+INTO|UPDATE\s+taxi_|DELETE\s+FROM|ALTER\s+TABLE)/i.test(national)]
];

for(const [name,ok] of checks){
  if(!ok) throw new Error('TN7_NATIONAL_1_STATIC_FAIL: '+name);
  console.log('PASS '+name);
}
console.log('TN7_NATIONAL_1_STATIC_PASS '+checks.length+'/'+checks.length);
