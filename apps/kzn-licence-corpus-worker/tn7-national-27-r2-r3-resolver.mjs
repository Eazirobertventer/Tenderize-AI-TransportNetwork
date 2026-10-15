import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const cfg=JSON.parse(await readFile(new URL('./tn7-national-27-r2-r3-manifest.json',import.meta.url),'utf8'));
const SOURCE={
  authority:'KwaZulu-Natal Department of Cooperative Governance and Traditional Affairs',
  host:'giswebmaps1.kzncogta.gov.za',
  serviceUrl:'https://giswebmaps1.kzncogta.gov.za/server/rest/services/Base_map_18032022/FeatureServer',
  layerId:10,
  outFields:'OBJECTID,STR_NAME,STR_NAME_L,STREET,AG_R_NAME,ROAD_ID,MRRTE,OLD_STR,CATEGORY'
};
const MAX_BYTES=24*1024*1024;

function sha256(buffer){return createHash('sha256').update(buffer).digest('hex');}
function assertOfficial(url){
  const u=new URL(url);
  if(u.protocol!=='https:'||u.hostname!==SOURCE.host) throw new Error('untrusted_official_source');
  return u;
}
function queryUrl(bbox){
  const u=assertOfficial(SOURCE.serviceUrl);
  u.pathname=u.pathname.replace(/\/$/,'')+'/'+SOURCE.layerId+'/query';
  u.search='';
  u.searchParams.set('where','1=1');
  u.searchParams.set('geometry',[bbox.xmin,bbox.ymin,bbox.xmax,bbox.ymax].join(','));
  u.searchParams.set('geometryType','esriGeometryEnvelope');
  u.searchParams.set('inSR','4326');
  u.searchParams.set('spatialRel','esriSpatialRelIntersects');
  u.searchParams.set('outFields',SOURCE.outFields);
  u.searchParams.set('returnGeometry','true');
  u.searchParams.set('outSR','4326');
  u.searchParams.set('f','geojson');
  return u.toString();
}
async function fetchOfficial(url){
  assertOfficial(url);
  const response=await fetch(url,{
    headers:{'user-agent':'TenderizeTransportNetwork/2.0 TN7-NATIONAL-27-R2-R3 topology-identity-readonly'},
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
  return {buffer,json,checksum:sha256(buffer),bytes:buffer.length,url};
}
function coords(g){
  if(!g) return [];
  if(g.type==='LineString') return g.coordinates||[];
  if(g.type==='MultiLineString') return (g.coordinates||[]).flat();
  return [];
}
function toRad(v){return v*Math.PI/180;}
function hav(a,b){
  const R=6371000;
  const dLat=toRad(b[1]-a[1]),dLon=toRad(b[0]-a[0]);
  const p1=toRad(a[1]),p2=toRad(b[1]);
  const h=Math.sin(dLat/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dLon/2)**2;
  return 2*R*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}
function minDistanceToPoint(feature,point){
  const c=coords(feature.geometry);
  if(!c.length) return null;
  let min=Infinity;
  for(const x of c) min=Math.min(min,hav(x,[point.longitude,point.latitude]));
  return Number.isFinite(min)?min:null;
}
function minFeatureDistance(a,b){
  const ac=coords(a.geometry),bc=coords(b.geometry);
  if(!ac.length||!bc.length) return null;
  let min=Infinity;
  for(const x of ac) for(const y of bc) min=Math.min(min,hav(x,y));
  return Number.isFinite(min)?min:null;
}
function propsText(f){
  return Object.values(f.properties||{}).map(v=>String(v??'')).join(' ').toLowerCase();
}
function literalMatches(features,road){
  const needle=road.toLowerCase();
  return features.filter(f=>propsText(f).includes(needle));
}
function r22Features(features){
  return features.filter(f=>/\br22(?:\/\d+)?\b/i.test(propsText(f)));
}
function summarizeFeature(f,extra={}){
  return {
    objectId:f.properties?.OBJECTID??null,
    strName:f.properties?.STR_NAME??null,
    street:f.properties?.STREET??null,
    agRoadName:f.properties?.AG_R_NAME??null,
    category:f.properties?.CATEGORY??null,
    ...extra
  };
}
function topologyCandidates(features,r22,kind){
  const anchor=cfg.anchors.mbazwana;
  const rows=[];
  for(const f of features){
    if(r22.includes(f)) continue;
    const toR22=Math.min(...r22.map(r=>minFeatureDistance(f,r)).filter(Number.isFinite));
    if(!Number.isFinite(toR22) || toR22>cfg.thresholds.touchingRoadMetres) continue;
    const toAnchor=minDistanceToPoint(f,anchor);
    if(kind==='P748' && (!Number.isFinite(toAnchor)||toAnchor>cfg.thresholds.nearMbazwanaAnchorMetres)) continue;
    if(kind==='L2887' && !['SECONDARY','ARTERIAL'].includes(String(f.properties?.CATEGORY||'').toUpperCase())) continue;
    rows.push(summarizeFeature(f,{
      distanceToR22Metres:Math.round(toR22*10)/10,
      distanceToMbazwanaAnchorMetres:Number.isFinite(toAnchor)?Math.round(toAnchor*10)/10:null
    }));
  }
  rows.sort((a,b)=>
    (a.distanceToMbazwanaAnchorMetres??Infinity)-(b.distanceToMbazwanaAnchorMetres??Infinity) ||
    a.distanceToR22Metres-b.distanceToR22Metres ||
    Number(a.objectId||0)-Number(b.objectId||0)
  );
  return rows;
}
function identityState(road,literal,candidates){
  if(literal.length>0) return {
    road,
    state:'authoritative_attribute_identity_resolved',
    literalFeatureCount:literal.length,
    candidateCount:candidates.length,
    promotionEligible:true
  };
  return {
    road,
    state:candidates.length===1?'unique_topology_candidate_documentary_confirmation_required':
      candidates.length>1?'multiple_topology_candidates_documentary_confirmation_required':
      'no_topology_candidate',
    literalFeatureCount:0,
    candidateCount:candidates.length,
    promotionEligible:false
  };
}

async function main(){
  const outDir=path.resolve(process.env.NATIONAL27_R2_R3_DIR||'artifacts/tn7-national-27-r2-r3');
  await mkdir(outDir,{recursive:true});

  const baseBbox={xmin:32.28,ymin:-27.75,xmax:32.82,ymax:-27.22};
  const base=await fetchOfficial(queryUrl(baseBbox));
  const sourceSnapshotMatches=base.checksum===cfg.sourceSnapshot.roadWindowSha256 &&
    base.json.features.length===cfg.sourceSnapshot.roadFeatureCount;
  if(cfg.policy.exactSourceSnapshotRequired && !sourceSnapshotMatches){
    throw new Error('r2r2_source_snapshot_drift');
  }

  const expanded=await fetchOfficial(queryUrl(cfg.expandedD234Window));
  await writeFile(path.join(outDir,'base-road-window.geojson'),base.buffer);
  await writeFile(path.join(outDir,'expanded-d234-window.geojson'),expanded.buffer);

  const r22=r22Features(base.json.features);
  if(!r22.length) throw new Error('r22_control_geometry_missing');

  const baseP748=literalMatches(base.json.features,'P748');
  const baseL2887=literalMatches(base.json.features,'L2887');
  const expandedD234=literalMatches(expanded.json.features,'D234');

  const p748Candidates=topologyCandidates(base.json.features,r22,'P748').slice(0,25);
  const l2887Candidates=topologyCandidates(base.json.features,r22,'L2887').slice(0,50);

  const identities={
    P748:identityState('P748',baseP748,p748Candidates),
    L2887:identityState('L2887',baseL2887,l2887Candidates),
    D234:identityState('D234',expandedD234,[])
  };

  const allResolved=Object.values(identities).every(x=>x.promotionEligible===true);
  const result={
    gate:'TN7-NATIONAL-27-R2-R3',
    mode:'road_identity_resolution_topological_corridor_matching',
    source:{
      authority:SOURCE.authority,
      baseWindow:{sha256:base.checksum,bytes:base.bytes,featureCount:base.json.features.length,sourceUrl:base.url},
      expandedD234Window:{sha256:expanded.checksum,bytes:expanded.bytes,featureCount:expanded.json.features.length,sourceUrl:expanded.url},
      exactR2R2SnapshotMatched:sourceSnapshotMatches
    },
    controls:{
      r22FeatureCount:r22.length,
      mbazwanaAnchor:cfg.anchors.mbazwana
    },
    resolution:{
      identities,
      literalMatches:{
        P748:baseP748.map(f=>summarizeFeature(f)),
        L2887:baseL2887.map(f=>summarizeFeature(f)),
        D234:expandedD234.map(f=>summarizeFeature(f))
      },
      topologyCandidates:{
        P748:p748Candidates,
        L2887:l2887Candidates
      },
      allRoadIdentitiesResolved:allResolved
    },
    policy:{
      ...cfg.policy,
      topologyDidNotCreateIdentity:true,
      automaticRoadIdentityPromotion:false,
      automaticRouteCandidateCreation:false,
      canonicalMutation:false
    }
  };

  await writeFile(path.join(outDir,'resolution.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
  console.log('TN7_NATIONAL_27_R2_R3_RUNTIME_PASS');
  if(allResolved) console.log('TN7_NATIONAL_27_R2_R3_ROAD_IDENTITY_READY');
  else console.log('TN7_NATIONAL_27_R2_R3_ROAD_IDENTITY_PARTIAL');
}

main().catch(error=>{
  console.error(JSON.stringify({event:'tn7_national_27_r2_r3_failed',error:String(error?.message||error)}));
  console.error('TN7_NATIONAL_27_R2_R3_RUNTIME_FAIL');
  process.exit(1);
});
