import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const sourceManifest=JSON.parse(
  await readFile(new URL('./tn7-national-27-r2-source-manifest.json',import.meta.url),'utf8')
);
const cacheDir=path.resolve(process.env.NATIONAL27_R2_CACHE_DIR||sourceManifest.cache.directory);

function sha256(buffer){
  return createHash('sha256').update(buffer).digest('hex');
}

function coords(geometry){
  if(!geometry) return [];
  if(geometry.type==='Point') return [geometry.coordinates];
  if(geometry.type==='LineString') return geometry.coordinates||[];
  if(geometry.type==='MultiLineString') return (geometry.coordinates||[]).flat();
  if(geometry.type==='Polygon') return (geometry.coordinates||[]).flat();
  if(geometry.type==='MultiPolygon') return (geometry.coordinates||[]).flat(2);
  return [];
}

function centroid(geometry){
  const c=coords(geometry).filter(x=>Array.isArray(x)&&x.length>=2&&Number.isFinite(x[0])&&Number.isFinite(x[1]));
  if(!c.length) return null;
  return {
    longitude:c.reduce((s,x)=>s+x[0],0)/c.length,
    latitude:c.reduce((s,x)=>s+x[1],0)/c.length
  };
}

function haversine(a,b){
  const [lon1,lat1]=a,[lon2,lat2]=b;
  const r=6371000,toRad=v=>v*Math.PI/180;
  const p1=toRad(lat1),p2=toRad(lat2),dp=toRad(lat2-lat1),dl=toRad(lon2-lon1);
  const h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*r*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}

function minVertexDistance(aFeatures,bFeatures){
  const a=aFeatures.flatMap(f=>coords(f.geometry));
  const b=bFeatures.flatMap(f=>coords(f.geometry));
  if(!a.length||!b.length) return null;
  let min=Infinity;
  for(const x of a) for(const y of b) min=Math.min(min,haversine(x,y));
  return Number.isFinite(min)?Math.round(min*10)/10:null;
}

function containsGluckstadt(feature){
  return Object.values(feature.properties||{}).some(v=>/gluckstadt/i.test(String(v||'')));
}

async function readVerified(fileName,expectedSha){
  const file=path.join(cacheDir,fileName);
  const buffer=await readFile(file);
  const actual=sha256(buffer);
  if(actual!==expectedSha) throw new Error('cache_checksum_mismatch:'+fileName);
  const json=JSON.parse(buffer.toString('utf8'));
  if(json.type!=='FeatureCollection'||!Array.isArray(json.features)) throw new Error('invalid_cached_geojson:'+fileName);
  return json;
}

async function main(){
  const cacheManifest=JSON.parse(await readFile(path.join(cacheDir,sourceManifest.cache.manifestFile),'utf8'));
  const byId=new Map(cacheManifest.entries.map(x=>[x.logicalId,x]));

  const rankEntry=byId.get('gluckstadt_bus_taxi_rank_zoning');
  if(!rankEntry) throw new Error('missing_gluckstadt_cache_entry');
  const rankGeo=await readVerified(rankEntry.file,rankEntry.sha256);
  const named=rankGeo.features.filter(containsGluckstadt);
  const rankCandidates=(named.length?named:rankGeo.features).map((feature,index)=>({
    index,
    properties:feature.properties||{},
    centroid:centroid(feature.geometry),
    basis:named.length?'explicit_gluckstadt_property_match':'abaqulusi_bus_taxi_rank_zoning_candidate'
  }));
  const exactGluckstadt=named.length===1?rankCandidates[0]:null;

  const roads={};
  for(const road of sourceManifest.sources.roads.requiredRoads){
    const entry=byId.get('road_'+road);
    if(!entry) throw new Error('missing_road_cache_entry:'+road);
    const geo=await readVerified(entry.file,entry.sha256);
    roads[road]={entry,features:geo.features};
  }

  const topology={
    d234GeometryPresent:roads.D234.features.some(f=>coords(f.geometry).length>1),
    p748GeometryPresent:roads.P748.features.some(f=>coords(f.geometry).length>1),
    r22GeometryPresent:roads.R22.features.some(f=>coords(f.geometry).length>1),
    l2887GeometryPresent:roads.L2887.features.some(f=>coords(f.geometry).length>1),
    p748ToR22MinVertexDistanceMetres:minVertexDistance(roads.P748.features,roads.R22.features),
    r22ToL2887MinVertexDistanceMetres:minVertexDistance(roads.R22.features,roads.L2887.features)
  };
  topology.manzimbovuSequenceContinuitySupported=
    topology.p748ToR22MinVertexDistanceMetres!==null &&
    topology.r22ToL2887MinVertexDistanceMetres!==null &&
    topology.p748ToR22MinVertexDistanceMetres<=150 &&
    topology.r22ToL2887MinVertexDistanceMetres<=150;

  const allRoadsPresent=[
    topology.d234GeometryPresent,topology.p748GeometryPresent,
    topology.r22GeometryPresent,topology.l2887GeometryPresent
  ].every(Boolean);

  const result={
    gate:'TN7-NATIONAL-27-R2',
    mode:'checksummed_feature_cache_offline_reconciliation',
    cacheManifest:{
      createdAt:cacheManifest.createdAt,
      manifestSha256:cacheManifest.manifestSha256,
      entries:cacheManifest.entries.map(x=>({
        logicalId:x.logicalId,authority:x.authority,serviceItemId:x.serviceItemId,
        layerId:x.layerId,sha256:x.sha256,bytes:x.bytes,featureCount:x.featureCount
      }))
    },
    gluckstadt:{
      totalBusTaxiRankZoningCandidates:rankGeo.features.length,
      explicitGluckstadtMatches:named.length,
      candidates:rankCandidates,
      exactUniqueControlCandidateRecovered:Boolean(exactGluckstadt),
      reconciliationState:exactGluckstadt
        ?'official_cogta_unique_gluckstadt_zoning_candidate_review_required'
        :'official_cogta_control_candidates_require_reconciliation',
      automaticRankCreation:false,
      canonicalMutation:false
    },
    mbazwana:{
      roadFeatureCounts:Object.fromEntries(Object.entries(roads).map(([road,x])=>[road,x.features.length])),
      topology,
      allRequiredRoadGeometryPresent:allRoadsPresent,
      topologyValidationReady:allRoadsPresent,
      routeCandidateCreationReady:false,
      automaticRouteCandidateCreation:false,
      canonicalMutation:false
    },
    policy:{
      offlineOnly:true,
      cacheChecksumsVerified:true,
      sourceAuthorityPreserved:true,
      geometryInvented:false,
      coordinatesInvented:false,
      proseToGeometrySynthesis:false,
      automaticRankCreation:false,
      automaticRouteCandidateCreation:false,
      canonicalMutation:false
    }
  };

  console.log(JSON.stringify(result));
  console.log('TN7_NATIONAL_27_R2_OFFLINE_RECONCILIATION_PASS');
  if(exactGluckstadt && allRoadsPresent && topology.manzimbovuSequenceContinuitySupported){
    console.log('TN7_NATIONAL_27_R2_FEATURE_RECOVERY_READY');
  }else{
    console.log('TN7_NATIONAL_27_R2_FEATURE_RECOVERY_PARTIAL');
  }
}

main().catch(error=>{
  console.error(JSON.stringify({event:'tn7_national_27_r2_offline_failed',error:String(error?.message||error)}));
  console.error('TN7_NATIONAL_27_R2_OFFLINE_RECONCILIATION_FAIL');
  process.exit(1);
});
