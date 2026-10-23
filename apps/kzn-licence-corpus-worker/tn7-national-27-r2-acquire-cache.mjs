import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const manifest=JSON.parse(
  await readFile(new URL('./tn7-national-27-r2-source-manifest.json',import.meta.url),'utf8')
);

const MAX_BYTES=16*1024*1024;

function sha256(buffer){
  return createHash('sha256').update(buffer).digest('hex');
}

function assertOfficial(url,expectedHost){
  const parsed=new URL(url);
  if(parsed.protocol!=='https:' || parsed.hostname!==expectedHost) throw new Error('untrusted_official_source');
  return parsed;
}

function layerQueryUrl(source,where,outFields){
  const u=assertOfficial(source.serviceUrl,source.host);
  u.pathname=u.pathname.replace(/\/$/,'')+'/'+source.layerId+'/query';
  u.search='';
  u.searchParams.set('where',where);
  u.searchParams.set('outFields',outFields);
  u.searchParams.set('returnGeometry','true');
  u.searchParams.set('outSR',String(source.query?.outSR||source.outSR||4326));
  u.searchParams.set('f','geojson');
  return u.toString();
}

async function fetchOfficial(url,host){
  assertOfficial(url,host);
  const response=await fetch(url,{
    headers:{'user-agent':'TenderizeTransportNetwork/2.0 TN7-NATIONAL-27-R2 official-export-readonly'},
    redirect:'error',
    signal:AbortSignal.timeout(60000)
  });
  if(!response.ok) throw new Error('HTTP '+response.status+' '+response.statusText);
  const declared=Number(response.headers.get('content-length')||0);
  if(declared>MAX_BYTES) throw new Error('official_export_too_large');
  const buffer=Buffer.from(await response.arrayBuffer());
  if(buffer.length>MAX_BYTES) throw new Error('official_export_too_large');
  const parsed=JSON.parse(buffer.toString('utf8'));
  if(parsed.error) throw new Error('arcgis_error:'+JSON.stringify(parsed.error));
  if(parsed.type!=='FeatureCollection' || !Array.isArray(parsed.features)) throw new Error('unexpected_geojson_shape');
  return {buffer,json:parsed,checksum:sha256(buffer),bytes:buffer.length,contentType:response.headers.get('content-type')||null};
}

function esc(value){
  return String(value).replaceAll("'","''");
}

function roadWhere(source,road){
  const value=esc(road);
  const clauses=[];
  for(const field of source.candidateFields||[]){
    clauses.push(`${field}='${value}'`);
    clauses.push(`${field} LIKE '%${value}%'`);
  }
  const numeric=Number(String(road).replace(/^[A-Za-z]+/,'')); 
  if(Number.isFinite(numeric)){
    for(const field of source.numericCandidateFields||[]) clauses.push(`${field}=${numeric}`);
  }
  return clauses.join(' OR ');
}

async function acquireStage({logicalId,url,host,filePath,metadata}){
  console.log(JSON.stringify({event:'tn7_national_27_r2_stage_start',logicalId,url}));
  try{
    const acquired=await fetchOfficial(url,host);
    await writeFile(filePath,acquired.buffer);
    const entry={
      logicalId,
      ...metadata,
      sourceUrl:url,
      file:path.basename(filePath),
      sha256:acquired.checksum,
      bytes:acquired.bytes,
      featureCount:acquired.json.features.length,
      acquiredAt:new Date().toISOString()
    };
    console.log(JSON.stringify({event:'tn7_national_27_r2_stage_pass',logicalId,featureCount:entry.featureCount,sha256:entry.sha256,bytes:entry.bytes}));
    return entry;
  }catch(error){
    console.error(JSON.stringify({event:'tn7_national_27_r2_stage_fail',logicalId,url,error:String(error?.message||error)}));
    throw error;
  }
}

async function main(){
  const outDir=path.resolve(process.env.NATIONAL27_R2_CACHE_DIR||manifest.cache.directory);
  await mkdir(outDir,{recursive:true});
  const entries=[];

  const rankSource=manifest.sources.gluckstadt;
  const rankUrl=layerQueryUrl(rankSource,rankSource.query.where,rankSource.query.outFields);
  const rankFile=path.join(outDir,manifest.cache.gluckstadtFile);
  entries.push(await acquireStage({
    logicalId:'gluckstadt_bus_taxi_rank_zoning',
    url:rankUrl,
    host:rankSource.host,
    filePath:rankFile,
    metadata:{
      authority:rankSource.authority,
      serviceItemId:rankSource.serviceItemId,
      layerId:rankSource.layerId,
      layerName:rankSource.layerName
    }
  }));

  const roadSource=manifest.sources.roads;
  for(const road of roadSource.requiredRoads){
    const where=roadWhere(roadSource,road);
    const url=layerQueryUrl(roadSource,where,roadSource.outFields);
    const fileName=manifest.cache.roadFiles[road];
    const filePath=path.join(outDir,fileName);
    entries.push(await acquireStage({
      logicalId:'road_'+road,
      url,
      host:roadSource.host,
      filePath,
      metadata:{
        road,
        authority:roadSource.authority,
        serviceItemId:roadSource.serviceItemId,
        layerId:roadSource.layerId,
        layerName:roadSource.layerName
      }
    }));
  }

  const cacheManifest={
    gate:'TN7-NATIONAL-27-R2',
    mode:'official_dataset_export_cache',
    createdAt:new Date().toISOString(),
    policy:manifest.policy,
    entries
  };
  const manifestBuffer=Buffer.from(JSON.stringify(cacheManifest,null,2)+'\n');
  cacheManifest.manifestSha256=sha256(manifestBuffer);
  await writeFile(path.join(outDir,manifest.cache.manifestFile),JSON.stringify(cacheManifest,null,2)+'\n');

  console.log(JSON.stringify({
    event:'tn7_national_27_r2_cache_complete',
    cacheDirectory:outDir,
    entries:entries.map(x=>({logicalId:x.logicalId,featureCount:x.featureCount,sha256:x.sha256,bytes:x.bytes})),
    manifestSha256:cacheManifest.manifestSha256
  }));
  console.log('TN7_NATIONAL_27_R2_OFFICIAL_EXPORT_CACHE_PASS');
}

main().catch(error=>{
  console.error(JSON.stringify({
    event:'tn7_national_27_r2_cache_failed',
    error:String(error?.message||error)
  }));
  console.error('TN7_NATIONAL_27_R2_OFFICIAL_EXPORT_CACHE_FAIL');
  process.exit(1);
});
