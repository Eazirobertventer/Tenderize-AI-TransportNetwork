import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const cfg=JSON.parse(await readFile(new URL('./tn7-national-27-r2-r2-manifest.json',import.meta.url),'utf8'));
const MAX_BYTES=20*1024*1024;

function sha256(buffer){return createHash('sha256').update(buffer).digest('hex');}
function toRad(v){return v*Math.PI/180;}
function haversine(a,b){
  const R=6371000;
  const dLat=toRad(b.latitude-a.latitude);
  const dLon=toRad(b.longitude-a.longitude);
  const p1=toRad(a.latitude),p2=toRad(b.latitude);
  const h=Math.sin(dLat/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dLon/2)**2;
  return 2*R*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}
function assertOfficial(url,host){
  const u=new URL(url);
  if(u.protocol!=='https:'||u.hostname!==host) throw new Error('untrusted_official_source');
  return u;
}
function spatialQueryUrl(source){
  const u=assertOfficial(source.serviceUrl,source.host);
  u.pathname=u.pathname.replace(/\/$/,'')+'/'+source.layerId+'/query';
  u.search='';
  u.searchParams.set('where','1=1');
  u.searchParams.set('geometry',[
    source.bbox4326.xmin,source.bbox4326.ymin,
    source.bbox4326.xmax,source.bbox4326.ymax
  ].join(','));
  u.searchParams.set('geometryType','esriGeometryEnvelope');
  u.searchParams.set('inSR','4326');
  u.searchParams.set('spatialRel','esriSpatialRelIntersects');
  u.searchParams.set('outFields',source.outFields);
  u.searchParams.set('returnGeometry','true');
  u.searchParams.set('outSR',String(source.outSR||4326));
  u.searchParams.set('f','geojson');
  return u.toString();
}
async function fetchOfficial(url,host){
  assertOfficial(url,host);
  const response=await fetch(url,{
    headers:{'user-agent':'TenderizeTransportNetwork/2.0 TN7-NATIONAL-27-R2-R2 official-spatial-recovery'},
    redirect:'error',
    signal:AbortSignal.timeout(60000)
  });
  if(!response.ok) throw new Error('HTTP '+response.status+' '+response.statusText);
  const declared=Number(response.headers.get('content-length')||0);
  if(declared>MAX_BYTES) throw new Error('response_too_large');
  const buffer=Buffer.from(await response.arrayBuffer());
  if(buffer.length>MAX_BYTES) throw new Error('response_too_large');
  const json=JSON.parse(buffer.toString('utf8'));
  if(json.error) throw new Error('arcgis_error:'+JSON.stringify(json.error));
  if(json.type!=='FeatureCollection'||!Array.isArray(json.features)) throw new Error('unexpected_geojson_shape');
  return {buffer,json,checksum:sha256(buffer),bytes:buffer.length};
}
function propsText(feature){
  return Object.values(feature.properties||{}).map(v=>String(v??'')).join(' ').toLowerCase();
}
function roadMatches(feature,road){
  const t=propsText(feature);
  const n=road.toLowerCase();
  return t.includes(n);
}
async function main(){
  const outDir=path.resolve(process.env.NATIONAL27_R2_R2_DIR||'artifacts/tn7-national-27-r2-r2');
  await mkdir(outDir,{recursive:true});

  const anchor=cfg.gluckstadt.officialAnchor;
  const distances=cfg.gluckstadt.candidateCentroids.map(candidate=>({
    ...candidate,
    distanceToOfficialAnchorMetres:Math.round(haversine(anchor,candidate)*10)/10,
    rejected:haversine(anchor,candidate)>cfg.gluckstadt.candidateRejectionThresholdMetres
  }));
  const accepted=distances.filter(x=>!x.rejected);

  const source=cfg.mbazwana.spatialRecovery;
  const url=spatialQueryUrl(source);
  const acquired=await fetchOfficial(url,source.host);
  const roadFile=path.join(outDir,'mbazwana-road-window.geojson');
  await writeFile(roadFile,acquired.buffer);

  const requested=['D234','P748','R22','L2887'];
  const literalMatches=Object.fromEntries(requested.map(road=>[
    road,
    acquired.json.features.filter(f=>roadMatches(f,road)).map(f=>({
      properties:f.properties||{},
      geometryType:f.geometry?.type||null
    }))
  ]));

  const result={
    gate:'TN7-NATIONAL-27-R2-R2',
    mode:'gluckstadt_disambiguation_missing_road_spatial_recovery',
    gluckstadt:{
      officialAnchor:anchor,
      candidates:distances,
      acceptedCandidates:accepted.length,
      bothCogtaCandidatesRejected:accepted.length===0,
      exactTaxiRankCoordinateRecovered:false,
      nextState:accepted.length===0
        ?'false_candidates_rejected_official_anchor_retained'
        :'candidate_review_required',
      automaticRankCreation:false,
      canonicalMutation:false
    },
    mbazwana:{
      officialAnchor:cfg.mbazwana.officialAnchor,
      roadWindow:{
        sourceAuthority:source.authority,
        sourceUrl:url,
        sha256:acquired.checksum,
        bytes:acquired.bytes,
        featureCount:acquired.json.features.length,
        bbox4326:source.bbox4326
      },
      documentaryRoadEvidence:cfg.mbazwana.roadEvidence,
      literalMatchCounts:Object.fromEntries(requested.map(r=>[r,literalMatches[r].length])),
      literalMatches,
      anonymousGeometryCandidateCount:acquired.json.features.length-
        new Set(requested.flatMap(r=>literalMatches[r].map(x=>JSON.stringify(x.properties)))).size,
      geometryRecoveryState:'bounded_official_spatial_window_recovered_identity_mapping_pending',
      routeCandidateCreationReady:false,
      automaticRouteCandidateCreation:false,
      canonicalMutation:false
    },
    policy:{
      ...cfg.policy,
      sourceResponsesChecksummed:true,
      boundedSpatialAcquisition:true,
      exactRoadIdentityRequiredBeforePromotion:true
    }
  };

  const resultBuffer=Buffer.from(JSON.stringify(result,null,2)+'\n');
  await writeFile(path.join(outDir,'reconciliation.json'),resultBuffer);

  console.log(JSON.stringify(result));
  console.log('TN7_NATIONAL_27_R2_R2_RUNTIME_PASS');
  if(result.gluckstadt.bothCogtaCandidatesRejected) console.log('TN7_NATIONAL_27_R2_R2_GLUCKSTADT_FALSE_CANDIDATES_REJECTED');
  const missing=requested.filter(r=>result.mbazwana.literalMatchCounts[r]===0);
  if(missing.length) console.log('TN7_NATIONAL_27_R2_R2_ROAD_IDENTITY_MAPPING_PENDING '+missing.join(','));
  else console.log('TN7_NATIONAL_27_R2_R2_ROAD_IDENTITY_READY');
}
main().catch(error=>{
  console.error(JSON.stringify({event:'tn7_national_27_r2_r2_failed',error:String(error?.message||error)}));
  console.error('TN7_NATIONAL_27_R2_R2_RUNTIME_FAIL');
  process.exit(1);
});
