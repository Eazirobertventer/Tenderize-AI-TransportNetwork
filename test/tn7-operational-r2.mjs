import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const app=readFileSync('live/app.js','utf8');
const index=readFileSync('live/index.html','utf8');
const web=readFileSync('live/server.mjs','utf8');
const api=readFileSync('apps/transport-api/src/server.mjs','utf8');

for(const path of ['live/app.js','live/server.mjs','apps/transport-api/src/server.mjs']){
  execFileSync(process.execPath,['--check',path],{stdio:'pipe'});
}

const checks=[
  [api.includes('async function postgisAssociationDetail'),'association detail API exists'],
  [api.includes("const area=url.searchParams.get('area')"),'association geography supports area scope'],
  [api.includes("WHERE a.id=$1::uuid"),'association detail uses parameterized identity lookup'],
  [api.includes("where.push('province = $'+params.length)"),'rank filter parameter placeholder is safe'],
  [web.includes("/^\\/api\\/v1\\/associations\\/[^/]+$/"),'association detail is explicitly public GET allow-listed'],
  [!web.includes("'/api/v1/data-issues'"),'detailed data issues remain private'],
  [index.includes('id="rankExplorerTab"'),'rank explorer tab exists'],
  [index.includes('id="associationExplorerTab"'),'association explorer tab exists'],
  [index.includes('id="associationFinder"'),'association finder exists'],
  [app.includes("association-highlight-ranks"),'association rank highlight layer exists'],
  [app.includes("association-highlight-routes"),'association route highlight layer exists'],
  [app.includes("fitAssociationNetwork"),'association network fit workflow exists'],
  [app.includes("data-satellite-inspect"),'satellite inspection actions exist'],
  [app.includes("Street View start") && app.includes("Street View end"),'route endpoint Street View exists'],
  [app.includes("setExplorerMode('associations')"),'coverage can enter association navigation mode'],
  [app.includes("selectedCoverageArea"),'municipality/city scope state exists'],
  [app.includes("data-fit-route"),'route fit action exists'],
  [web.includes("if(!['GET','HEAD'].includes"),'web remains GET/HEAD only']
];

for(const [ok,label] of checks) console.log((ok?'PASS':'FAIL')+' '+label);
const failed=checks.filter(([ok])=>!ok);
if(failed.length){
  console.error('TN7_R2_STATIC_FAIL '+failed.length+'/'+checks.length);
  process.exitCode=1;
}else{
  console.log('TN7_R2_STATIC_PASS '+checks.length+'/'+checks.length);
}
