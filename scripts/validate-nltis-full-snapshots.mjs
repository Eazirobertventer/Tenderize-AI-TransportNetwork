import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root=resolve(new URL('..',import.meta.url).pathname);

const expected=[
  {
    path:'apps/nltis-worker/verified-snapshots/pretoria-plaza.json',
    sourceId:'nltis-pretoria-plaza',
    registrationNumber:'RASGPA0333774',
    reportRouteRowCount:23,
    reportPageCount:5
  },
  {
    path:'apps/nltis-worker/verified-snapshots/ivory-park.json',
    sourceId:'nltis-ivory-park',
    registrationNumber:'RASGPA0333747',
    reportRouteRowCount:44,
    reportPageCount:11
  },
  {
    path:'apps/nltis-worker/verified-snapshots/armsta.json',
    sourceId:'nltis-armsta',
    registrationNumber:'RASGPA0134237',
    reportRouteRowCount:118,
    reportPageCount:23
  },
  {
    path:'apps/nltis-worker/verified-snapshots/greater-bloemfontein.json',
    sourceId:'nltis-greater-bloemfontein',
    registrationNumber:'RASFSA0134187',
    reportRouteRowCount:140,
    reportPageCount:13
  }
];

const errors=[];
const summaries=[];

for(const item of expected){
  const snapshot=JSON.parse(await readFile(resolve(root,item.path),'utf8'));
  const routes=Array.isArray(snapshot.routes)?snapshot.routes:[];
  const quarantined=Array.isArray(snapshot.quarantinedRows)?snapshot.quarantinedRows:[];

  if(snapshot.sourceId!==item.sourceId) errors.push(item.sourceId+': sourceId mismatch');
  if(snapshot.association?.registrationNumber!==item.registrationNumber){
    errors.push(item.sourceId+': registration-number mismatch');
  }
  if(snapshot.completeness!=='full_report') errors.push(item.sourceId+': completeness must be full_report');
  if(snapshot.reportRouteRowCount!==item.reportRouteRowCount){
    errors.push(item.sourceId+': reportRouteRowCount mismatch');
  }
  if(snapshot.reportPageCount!==item.reportPageCount){
    errors.push(item.sourceId+': reportPageCount mismatch');
  }
  if(snapshot.routeCount!==routes.length){
    errors.push(item.sourceId+': routeCount does not equal routes.length');
  }
  if(routes.length+quarantined.length!==item.reportRouteRowCount){
    errors.push(item.sourceId+': structured + quarantined rows do not equal report row count');
  }

  const routeSeq=new Set();
  const quarantineSeq=new Set();

  for(const route of routes){
    const seq=Number(route.sequence);
    if(!Number.isInteger(seq) || seq<1 || seq>item.reportRouteRowCount){
      errors.push(item.sourceId+': invalid route sequence '+route.sequence);
      continue;
    }
    if(routeSeq.has(seq)) errors.push(item.sourceId+': duplicate structured sequence '+seq);
    routeSeq.add(seq);

    for(const key of ['origin','destination','nationalRouteCode','boardRouteCode']){
      if(typeof route[key]!=='string' || !route[key].trim()){
        errors.push(item.sourceId+': sequence '+seq+' missing '+key);
      }
    }
  }

  for(const row of quarantined){
    const seq=Number(row.sequence);
    if(!Number.isInteger(seq) || seq<1 || seq>item.reportRouteRowCount){
      errors.push(item.sourceId+': invalid quarantine sequence '+row.sequence);
      continue;
    }
    if(quarantineSeq.has(seq)) errors.push(item.sourceId+': duplicate quarantine sequence '+seq);
    quarantineSeq.add(seq);
    if(routeSeq.has(seq)) errors.push(item.sourceId+': sequence '+seq+' appears in both routes and quarantine');
    if(typeof row.reason!=='string' || !row.reason.trim()){
      errors.push(item.sourceId+': quarantine sequence '+seq+' missing reason');
    }
  }

  const missing=[];
  for(let seq=1;seq<=item.reportRouteRowCount;seq++){
    if(!routeSeq.has(seq) && !quarantineSeq.has(seq)) missing.push(seq);
  }
  if(missing.length){
    errors.push(item.sourceId+': missing report sequences '+missing.join(','));
  }

  const nationalCounts=new Map();
  for(const route of routes){
    nationalCounts.set(route.nationalRouteCode,(nationalCounts.get(route.nationalRouteCode)||0)+1);
  }
  const repeatedNationalRouteCodes=[...nationalCounts.entries()]
    .filter(([,count])=>count>1)
    .map(([code,count])=>({code,count}));

  summaries.push({
    sourceId:item.sourceId,
    reportRows:item.reportRouteRowCount,
    structuredRoutes:routes.length,
    quarantinedRows:quarantined.length,
    sequenceCoverage:item.reportRouteRowCount-missing.length,
    repeatedNationalRouteCodes
  });
}

if(errors.length){
  console.error('NLTIS full snapshot validation failed');
  for(const error of errors) console.error('- '+error);
  process.exit(1);
}

console.log(JSON.stringify({
  event:'nltis_full_snapshots_valid',
  associations:summaries.length,
  reportRows:summaries.reduce((sum,item)=>sum+item.reportRows,0),
  structuredRoutes:summaries.reduce((sum,item)=>sum+item.structuredRoutes,0),
  quarantinedRows:summaries.reduce((sum,item)=>sum+item.quarantinedRows,0),
  summaries
}));
