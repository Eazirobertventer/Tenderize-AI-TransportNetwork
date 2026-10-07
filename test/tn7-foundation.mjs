import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const files={
  app:'live/app.js',
  index:'live/index.html',
  web:'live/server.mjs',
  api:'apps/transport-api/src/server.mjs',
  roadmap:'docs/TN7_ROADMAP.md'
};

for(const path of [files.app,files.web,files.api]){
  execFileSync(process.execPath,['--check',path],{stdio:'pipe'});
}

const app=readFileSync(files.app,'utf8');
const index=readFileSync(files.index,'utf8');
const web=readFileSync(files.web,'utf8');
const api=readFileSync(files.api,'utf8');
const roadmap=readFileSync(files.roadmap,'utf8');

const assertions=[
  [app.includes("streetViewUrl"),'Street View helper exists'],
  [app.includes("association-points"),'association map layer exists'],
  [app.includes("loadCoverage"),'coverage UI loader exists'],
  [index.includes('id="associationToggle"'),'association layer control exists'],
  [index.includes('id="coverageProvinces"'),'coverage dashboard container exists'],
  [api.includes("postgisCoverage"),'coverage API exists'],
  [api.includes("postgisAssociationMap"),'association geography API exists'],
  [api.includes("postgisDataQualitySummary"),'aggregate quality API exists'],
  [web.includes("'/api/v1/coverage'"),'coverage is in public GET allow-list'],
  [web.includes("'/api/v1/associations/map'"),'association geography is in public GET allow-list'],
  [web.includes("'/api/v1/data-quality/summary'"),'aggregate quality is in public GET allow-list'],
  [!web.includes("'/api/v1/data-issues'"),'detailed data issues remain private'],
  [roadmap.includes('Street View'),'TN7 roadmap includes street-level inspection'],
  [roadmap.includes('all nine provinces'),'TN7 roadmap includes national expansion'],
  [roadmap.includes('operator authentication'),'TN7 roadmap gates adjudication behind operator auth']
];

const failed=assertions.filter(([ok])=>!ok);
for(const [ok,label] of assertions){
  console.log((ok?'PASS':'FAIL')+' '+label);
}
if(failed.length){
  process.exitCode=1;
}else{
  console.log('TN7_FOUNDATION_STATIC_PASS '+assertions.length+'/'+assertions.length);
}
