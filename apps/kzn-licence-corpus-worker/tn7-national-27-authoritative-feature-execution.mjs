import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync=promisify(execFile);

const cfg=JSON.parse(await readFile(new URL('./tn7-national-26-control-point-road-acquisition.json',import.meta.url),'utf8'));
const OFFICIAL_HOST='gis.kznpidh.gov.za';
const MAX_BYTES=8*1024*1024;

function assertOfficial(url){
  const parsed=new URL(url);
  if(parsed.protocol!=='https:' || parsed.hostname!==OFFICIAL_HOST) throw new Error('untrusted_feature_host');
  return parsed;
}

function checksum(buffer){
  return createHash('sha256').update(buffer).digest('hex');
}

function errorChain(error){
  const items=[];
  let current=error;
  for(let depth=0;current && depth<6;depth++){
    items.push({
      name:current.name||null,
      code:current.code||current.errno||null,
      message:String(current.message||current)
    });
    current=current.cause;
  }
  return items;
}

async function curlFallback(url){
  assertOfficial(url);
  const path='/tmp/tn7-national-27-'+createHash('sha256').update(url).digest('hex').slice(0,16)+'.bin';
  try{
    await execFileAsync('curl',[
      '--fail','--silent','--show-error',
      '--proto','=https',
      '--max-time','45',
      '--max-filesize',String(MAX_BYTES),
      '--output',path,
      url
    ],{timeout:50000,maxBuffer:1024*1024});
    const buffer=await readFile(path);
    if(buffer.length>MAX_BYTES) throw new Error('feature_response_too_large');
    return {ok:true,transport:'curl_strict_tls',bytes:buffer.length,checksum:checksum(buffer),contentType:null,buffer};
  }catch(error){
    return {ok:false,transport:'curl_strict_tls',error:String(error?.message||error),errorChain:errorChain(error)};
  }finally{
    await unlink(path).catch(()=>{});
  }
}

async function boundedFetch(url){
  assertOfficial(url);
  let primaryError=null;
  try{
    const response=await fetch(url,{
      headers:{'user-agent':'TenderizeTransportNetwork/2.0 TN7-NATIONAL-27 authoritative-feature-readonly'},
      redirect:'error',
      signal:AbortSignal.timeout(45000)
    });
    if(!response.ok) throw new Error('HTTP '+response.status+' '+response.statusText);
    const declared=Number(response.headers.get('content-length')||0);
    if(declared>MAX_BYTES) throw new Error('feature_response_too_large');
    const buffer=Buffer.from(await response.arrayBuffer());
    if(buffer.length>MAX_BYTES) throw new Error('feature_response_too_large');
    return {ok:true,transport:'node_fetch_strict_tls',bytes:buffer.length,checksum:checksum(buffer),contentType:response.headers.get('content-type')||null,buffer};
  }catch(error){
    primaryError={error:String(error?.message||error),errorChain:errorChain(error)};
  }
  const fallback=await curlFallback(url);
  if(fallback.ok) return {...fallback,primaryError};
  return {
    ok:false,
    error:'all_strict_tls_transports_failed',
    primary:primaryError,
    fallback:{error:fallback.error,errorChain:fallback.errorChain},
    transportAttempts:['node_fetch_strict_tls','curl_strict_tls']
  };
}

function queryUrl(layer,{where,outFields}){
  const base=assertOfficial(layer.serviceUrl);
  base.pathname=base.pathname.replace(/\/$/,'')+'/'+layer.layerId+'/query';
  base.search='';
  base.searchParams.set('where',where);
  base.searchParams.set('outFields',outFields);
  base.searchParams.set('returnGeometry','true');
  base.searchParams.set('outSR','4326');
  base.searchParams.set('f','geojson');
  return base.toString();
}

function parseGeoJson(acquired,url){
  if(!acquired.ok) return {...acquired,url,features:[]};
  try{
    const json=JSON.parse(acquired.buffer.toString('utf8'));
    if(json.error) throw new Error('arcgis_error:'+JSON.stringify(json.error));
    if(json.type!=='FeatureCollection' || !Array.isArray(json.features)) throw new Error('unexpected_geojson_shape');
    return {
      ok:true,url,bytes:acquired.bytes,checksum:acquired.checksum,
      contentType:acquired.contentType,features:json.features
    };
  }catch(error){
    return {ok:false,url,error:String(error?.message||error),features:[],checksum:acquired.checksum||null,bytes:acquired.bytes||null};
  }
}

function coordsFromGeometry(geometry){
  if(!geometry) return [];
  if(geometry.type==='Point') return [geometry.coordinates];
  if(geometry.type==='LineString') return geometry.coordinates||[];
  if(geometry.type==='MultiLineString') return (geometry.coordinates||[]).flat();
  return [];
}

function haversine(a,b){
  const [lon1,lat1]=a,[lon2,lat2]=b;
  const r=6371000, toRad=v=>v*Math.PI/180;
  const p1=toRad(lat1),p2=toRad(lat2),dp=toRad(lat2-lat1),dl=toRad(lon2-lon1);
  const h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*r*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}

function minVertexDistance(featuresA,featuresB){
  const a=featuresA.flatMap(f=>coordsFromGeometry(f.geometry));
  const b=featuresB.flatMap(f=>coordsFromGeometry(f.geometry));
  if(!a.length||!b.length) return null;
  let min=Infinity;
  for(const x of a) for(const y of b) min=Math.min(min,haversine(x,y));
  return Number.isFinite(min)?Math.round(min*10)/10:null;
}

async function main(){
  const rankLayer=cfg.gluckstadt.officialFeatureService;
  const roadLayer={...cfg.mbazwana.alternateAcquisition,serviceUrl:cfg.mbazwana.alternateAcquisition.serviceUrl};

  const rankUrl=queryUrl(rankLayer,{
    where:"RANK_CODE LIKE '%GLUCK%'",
    outFields:'OBJECTID_12_13,RANK_CODE,SNAPPED,SNAP_DIST'
  });
  const rank=parseGeoJson(await boundedFetch(rankUrl),rankUrl);

  const roads={};
  for(const roadNumber of cfg.mbazwana.requiredRoads){
    const url=queryUrl(roadLayer,{
      where:"ROADNUM='"+roadNumber+"'",
      outFields:'FID,ROADKEY,ROADNUM,CLASS,START_KM,END_KM,KM_LENGTH,RK_FROM,RK_TO'
    });
    roads[roadNumber]=parseGeoJson(await boundedFetch(url),url);
  }

  const pointCandidates=rank.features.filter(f=>f?.geometry?.type==='Point' && Array.isArray(f.geometry.coordinates));
  const uniquePoint=pointCandidates.length===1 ? pointCandidates[0] : null;

  const topology={
    d234GeometryPresent:(roads.D234?.features||[]).some(f=>coordsFromGeometry(f.geometry).length>1),
    p748GeometryPresent:(roads.P748?.features||[]).some(f=>coordsFromGeometry(f.geometry).length>1),
    r22GeometryPresent:(roads.R22?.features||[]).some(f=>coordsFromGeometry(f.geometry).length>1),
    l2887GeometryPresent:(roads.L2887?.features||[]).some(f=>coordsFromGeometry(f.geometry).length>1),
    p748ToR22MinVertexDistanceMetres:minVertexDistance(roads.P748?.features||[],roads.R22?.features||[]),
    r22ToL2887MinVertexDistanceMetres:minVertexDistance(roads.R22?.features||[],roads.L2887?.features||[])
  };
  topology.manzimbovuSequenceContinuitySupported=
    topology.p748ToR22MinVertexDistanceMetres!==null &&
    topology.r22ToL2887MinVertexDistanceMetres!==null &&
    topology.p748ToR22MinVertexDistanceMetres<=150 &&
    topology.r22ToL2887MinVertexDistanceMetres<=150;

  const allRoadQueriesSucceeded=cfg.mbazwana.requiredRoads.every(r=>roads[r]?.ok===true);
  const allRequiredRoadGeometryPresent=[
    topology.d234GeometryPresent,topology.p748GeometryPresent,
    topology.r22GeometryPresent,topology.l2887GeometryPresent
  ].every(Boolean);

  const result={
    gate:'TN7-NATIONAL-27',
    mode:'authoritative_feature_execution_gluckstadt_reconciliation_mbazwana_topology',
    sourceAuthority:'KwaZulu-Natal Office of the Premier / Department of Transport',
    sourceHost:OFFICIAL_HOST,
    executedAt:new Date().toISOString(),
    gluckstadt:{
      query:{ok:rank.ok,error:rank.error||null,checksum:rank.checksum||null,bytes:rank.bytes||null,transport:rank.transport||null,diagnostic:rank.primary||rank.fallback||null},
      authoritativePointCandidates:pointCandidates.map(f=>({
        properties:f.properties||{},
        longitude:f.geometry.coordinates[0],
        latitude:f.geometry.coordinates[1]
      })),
      exactUniquePointRecovered:Boolean(uniquePoint),
      reconciliationState:uniquePoint?'authoritative_unique_point_candidate_review_required':'authoritative_unique_point_not_recovered',
      automaticRankCreation:false,
      canonicalMutation:false
    },
    mbazwana:{
      roadAcquisition:Object.fromEntries(Object.entries(roads).map(([road,x])=>[road,{
        ok:x.ok,error:x.error||null,checksum:x.checksum||null,bytes:x.bytes||null,transport:x.transport||null,diagnostic:x.primary||x.fallback||null,
        featureCount:x.features.length,
        geometryFeatureCount:x.features.filter(f=>coordsFromGeometry(f.geometry).length>1).length
      }])),
      topology,
      allRoadQueriesSucceeded,
      allRequiredRoadGeometryPresent,
      topologyValidationReady:allRoadQueriesSucceeded && allRequiredRoadGeometryPresent,
      routeCandidateCreationReady:false,
      automaticRouteCandidateCreation:false,
      canonicalMutation:false
    },
    policy:{
      fixedOfficialHostOnly:true,
      deterministicTransportFallback:true,
      tlsVerificationBypassed:false,
      redirectFollowed:false,
      sourceResponsesChecksummed:true,
      proseToGeometrySynthesis:false,
      geometryInvented:false,
      coordinatesInvented:false,
      automaticRankCreation:false,
      automaticRouteCandidateCreation:false,
      canonicalMutation:false
    }
  };

  console.log(JSON.stringify(result));
  if(!rank.ok || !allRoadQueriesSucceeded){
    console.error('TN7_NATIONAL_27_SOURCE_EXECUTION_BLOCKED');
    process.exitCode=2;
    return;
  }
  console.log('TN7_NATIONAL_27_AUTHORITATIVE_FEATURE_EXECUTION_PASS');
}

await main();
