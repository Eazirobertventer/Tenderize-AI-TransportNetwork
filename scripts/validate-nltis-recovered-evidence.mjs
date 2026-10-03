import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root=resolve(new URL('..',import.meta.url).pathname);
const sources=JSON.parse(await readFile(resolve(root,'apps/nltis-worker/sources.json'),'utf8'));
const evidence=JSON.parse(await readFile(resolve(root,'apps/nltis-worker/verified-report-evidence.json'),'utf8'));

const expected=new Map(sources.map(source=>[source.id,source]));
const errors=[];

for(const item of evidence.associations || []){
  const source=expected.get(item.sourceId);
  if(!source){
    errors.push(item.sourceId + ': source not configured');
    continue;
  }

  if(source.registrationNumber!==item.registrationNumber){
    errors.push(item.sourceId + ': registration mismatch');
  }

  if(source.associationName.toUpperCase()!==item.associationName.toUpperCase()){
    errors.push(item.sourceId + ': association-name mismatch');
  }

  const url=new URL(item.reportUrl);
  if(url.hostname.toLowerCase()!=='nltis.transport.gov.za'){
    errors.push(item.sourceId + ': report URL is not official NLTIS');
  }

  if(item.evidenceState!=='official_report_indexed'){
    errors.push(item.sourceId + ': invalid evidence state');
  }

  if(item.completeness!=='representative_routes_only'){
    errors.push(item.sourceId + ': recovered evidence must remain explicitly partial');
  }

  if(!Number.isInteger(item.pageCount) || item.pageCount<1){
    errors.push(item.sourceId + ': invalid page count');
  }

  if(!Number.isInteger(item.highestSequenceObserved) || item.highestSequenceObserved<1){
    errors.push(item.sourceId + ': invalid highest sequence');
  }

  if(!Array.isArray(item.sampleRoutes) || item.sampleRoutes.length<3){
    errors.push(item.sourceId + ': insufficient representative routes');
  }else{
    for(const route of item.sampleRoutes){
      for(const key of ['sequence','routeName','nationalRouteCode','boardRouteCode','origin','destination']){
        if(!route[key]) errors.push(item.sourceId + ': route missing ' + key);
      }
    }
  }
}

const recoveredIds=new Set((evidence.associations || []).map(item=>item.sourceId));
for(const sourceId of ['nltis-armsta','nltis-ivory-park','nltis-pretoria-plaza','nltis-greater-bloemfontein']){
  if(!recoveredIds.has(sourceId)) errors.push(sourceId + ': recovered report evidence missing');
}

if(errors.length){
  console.error('Recovered NLTIS evidence validation failed');
  for(const error of errors) console.error('- ' + error);
  process.exit(1);
}

console.log(JSON.stringify({
  event:'nltis_recovered_evidence_valid',
  associations:evidence.associations.length,
  routeSamples:evidence.associations.reduce((sum,item)=>sum+item.sampleRoutes.length,0),
  autoIngestFallback:false
}));
