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

function roadWhere(fields,road){
  const value=esc(road);
  return fields.flatMap(field=>[
    `${field}='${value}'`,
    `${field} LIKE '%${value}%'`
  ]).join(' OR ');
}

async function main(){
  const outDir=path.resolve(process.env.NATIONAL27_R2_CACHE_DIR||manifest.cache.directory);
  await mkdir(outDir,{recursive:true});
  const entries=[];

  const rankSource=manifest.sources.gluckstadt;
  const rankUrl=layerQueryUrl(rankSource,rankSource.query.where,rankSource.query.outFields);
  const rank=await fetchOfficial(rankUrl,rankSource.host);
  const rankFile=path.join(outDir,manifest.cache.gluckstadtFile);
  await writeFile(rankFile,rank.buffer);
  entries.push({
    logicalId:'gluckstadt_bus_taxi_rank_zoning',
    authority:rankSource.authority,
    serviceItemId:rankSource.serviceItemId,
    layerId:rankSource.layerId,
    layerName:rankSource.layerName,
    sourceUrl:rankUrl,
    file:path.basename(rankFile),
    sha256:rank.checksum,
    bytes:rank.bytes,
    featureCount:rank.json.features.length,
    acquiredAt:new Date().toISOString()
  });

  const roadSource=manifest.sources.roads;
  for(const road of roadSource.requiredRoads){
    const where=roadWhere(roadSource.candidateFields,road);
    const url=layerQueryUrl(roadSource,where,roadSource.outFields);
    const acquired=await fetchOfficial(url,roadSource.host);
    const fileName=manifest.cache.roadFiles[road];
    const filePath=path.join(outDir,fileName);
    await writeFile(filePath,acquired.buffer);
    entries.push({
      logicalId:'road_'+road,
      road,
      authority:roadSource.authority,
      serviceItemId:roadSource.serviceItemId,
      layerId:roadSource.layerId,
      layerName:roadSource.layerName,
      sourceUrl:url,
      file:fileName,
      sha256:acquired.checksum,
      bytes:acquired.bytes,
      featureCount:acquired.json.features.length,
      acquiredAt:new Date().toISOString()
    });
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
