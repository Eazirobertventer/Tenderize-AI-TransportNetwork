import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const cfg=JSON.parse(await readFile(new URL('./tn7-national-27-r2-r6-legacy-register.json',import.meta.url),'utf8'));

const SOURCE={
  host:cfg.currentGis.host,
  serviceUrl:cfg.currentGis.serviceUrl,
  layerId:cfg.currentGis.layerId,
  outFields:cfg.currentGis.outFields
};
const MAX_BYTES=16*1024*1024;
const MBAZWANA_BBOX={xmin:32.42,ymin:-27.62,xmax:32.72,ymax:-27.32};

function sha256(buffer){return createHash('sha256').update(buffer).digest('hex');}
function assertOfficial(url){
  const u=new URL(url);
  if(u.protocol!=='https:'||u.hostname!==SOURCE.host) throw new Error('untrusted_official_source');
  return u;
}
function spatialQueryUrl(){
  const u=assertOfficial(SOURCE.serviceUrl);
  u.pathname=u.pathname.replace(/\/$/,'')+'/'+SOURCE.layerId+'/query';
  u.search='';
  u.searchParams.set('where','1=1');
  u.searchParams.set('geometry',[MBAZWANA_BBOX.xmin,MBAZWANA_BBOX.ymin,MBAZWANA_BBOX.xmax,MBAZWANA_BBOX.ymax].join(','));
  u.searchParams.set('geometryType','esriGeometryEnvelope');
  u.searchParams.set('inSR','4326');
  u.searchParams.set('spatialRel','esriSpatialRelIntersects');
  u.searchParams.set('outFields',SOURCE.outFields);
  u.searchParams.set('returnGeometry','true');
  u.searchParams.set('outSR','4326');
  u.searchParams.set('f','geojson');
  return u.toString();
}
function idsQueryUrl(ids){
  const u=assertOfficial(SOURCE.serviceUrl);
  u.pathname=u.pathname.replace(/\/$/,'')+'/'+SOURCE.layerId+'/query';
  u.search='';
  u.searchParams.set('where','OBJECTID IN ('+ids.join(',')+')');
  u.searchParams.set('outFields',SOURCE.outFields);
  u.searchParams.set('returnGeometry','false');
  u.searchParams.set('f','json');
  return u.toString();
}
async function fetchOfficial(url){
  assertOfficial(url);
  const response=await fetch(url,{
    headers:{'user-agent':'TenderizeTransportNetwork/2.0 TN7-NATIONAL-27-R2-R6 legacy-register-readonly'},
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
  return {json,buffer,checksum:sha256(buffer),bytes:buffer.length,url};
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
function canonicalCode(props={}){
  for(const k of ['STR_NAME','STREET','AG_R_NAME','ROAD_ID','OLD_STR']){
    const v=String(props[k]??'').trim();
    if(v && v!==' ') return v.replace(/\s+Road$/i,'').trim();
  }
  return '';
}
function textProps(f){return Object.values(f.properties||{}).map(v=>String(v??'')).join(' ');}
function matchesCode(f,code){
  const re=new RegExp('\\b'+code+'(?:\\/\\d+)?\\b','i');
  return re.test(textProps(f));
}
function nearestPair(featuresA,featuresB){
  let best=null;
  for(const a of featuresA){
    for(const b of featuresB){
      for(const x of coords(a.geometry)){
        for(const y of coords(b.geometry)){
          const d=hav(x,y);
          if(!best||d<best.distanceMetres) best={a,b,x,y,distanceMetres:d};
        }
      }
    }
  }
  return best;
}
function minDistanceFeatureToPoint(feature,point){
  let min=Infinity;
  for(const x of coords(feature.geometry)) min=Math.min(min,hav(x,point));
  return Number.isFinite(min)?min:null;
}
function summarize(f,extra={}){
  return {
    objectId:f.properties?.OBJECTID??null,
    code:canonicalCode(f.properties||{})||null,
    category:f.properties?.CATEGORY??null,
    oldStr:String(f.properties?.OLD_STR??'').trim()||null,
    roadId:String(f.properties?.ROAD_ID??'').trim()||null,
    ...extra
  };
}
function exactLegacyAlias(feature,target){
  const p=feature.properties||{};
  return [p.OLD_STR,p.ROAD_ID,p.STR_NAME,p.STREET,p.AG_R_NAME]
    .filter(v=>v!==null&&v!==undefined)
    .some(v=>new RegExp('^'+target+'(?:\\b|\\/|-)','i').test(String(v).trim()));
}
async function main(){
  const outDir=path.resolve(process.env.NATIONAL27_R2_R6_DIR||'artifacts/tn7-national-27-r2-r6');
  await mkdir(outDir,{recursive:true});

  const roadWindow=await fetchOfficial(spatialQueryUrl());
  if(roadWindow.json.type!=='FeatureCollection'||!Array.isArray(roadWindow.json.features)) throw new Error('unexpected_road_window_shape');
  await writeFile(path.join(outDir,'mbazwana-crossing-window.geojson'),roadWindow.buffer);

  const r22=roadWindow.json.features.filter(f=>matchesCode(f,'R22'));
  const p447=roadWindow.json.features.filter(f=>matchesCode(f,'P447'));
  if(!r22.length) throw new Error('r22_control_missing');
  if(!p447.length) throw new Error('p447_control_missing');

  const crossing=nearestPair(r22,p447);
  if(!crossing) throw new Error('p447_r22_crossing_not_found');
  const crossingPoint=[(crossing.x[0]+crossing.y[0])/2,(crossing.x[1]+crossing.y[1])/2];

  const crossingCandidates=roadWindow.json.features
    .filter(f=>!r22.includes(f)&&!p447.includes(f))
    .map(f=>({feature:f,d:minDistanceFeatureToPoint(f,crossingPoint)}))
    .filter(x=>Number.isFinite(x.d)&&x.d<=cfg.currentGis.candidateSearchRadiusMetres)
    .map(x=>summarize(x.feature,{
      distanceToP447R22CrossingMetres:Math.round(x.d*10)/10,
      explicitP748Alias:exactLegacyAlias(x.feature,'P748')
    }))
    .sort((a,b)=>a.distanceToP447R22CrossingMetres-b.distanceToP447R22CrossingMetres||Number(a.objectId)-Number(b.objectId));

  const explicitP748=crossingCandidates.filter(x=>x.explicitP748Alias);

  const lIds=cfg.r5State.L2887.remainingObjectIds;
  const lRows=await fetchOfficial(idsQueryUrl(lIds));
  if(!Array.isArray(lRows.json.features)) throw new Error('unexpected_l2887_shape');
  const lEval=lRows.json.features.map(f=>{
    const a=f.attributes||{};
    const pseudo={properties:a};
    return {
      objectId:a.OBJECTID??null,
      code:canonicalCode(a)||null,
      oldStr:String(a.OLD_STR??'').trim()||null,
      roadId:String(a.ROAD_ID??'').trim()||null,
      explicitL2887Alias:exactLegacyAlias(pseudo,'L2887')
    };
  });
  const explicitL2887=lEval.filter(x=>x.explicitL2887Alias);

  const result={
    gate:'TN7-NATIONAL-27-R2-R6',
    mode:'archived_register_legacy_gis_recovery',
    source:{
      currentGeometryAuthority:cfg.currentGis.authority,
      crossingWindow:{
        sourceUrl:roadWindow.url,
        sha256:roadWindow.checksum,
        bytes:roadWindow.bytes,
        featureCount:roadWindow.json.features.length
      },
      l2887Revalidation:{
        sourceUrl:lRows.url,
        sha256:lRows.checksum,
        bytes:lRows.bytes,
        featureCount:lRows.json.features.length
      },
      legacyGisRepository:cfg.legacyEvidence.legacyGisRepository
    },
    P748:{
      documentedSequence:'P748 -> cross R22 -> P447',
      r22ControlFeatureCount:r22.length,
      p447ControlFeatureCount:p447.length,
      p447R22NearestDistanceMetres:Math.round(crossing.distanceMetres*10)/10,
      crossingPoint:{longitude:crossingPoint[0],latitude:crossingPoint[1]},
      geometricContinuationCandidates:crossingCandidates,
      explicitLegacyAliasMatches:explicitP748.length,
      state:explicitP748.length===1
        ?'explicit_legacy_alias_recovered'
        :crossingCandidates.length===1
          ?'single_geometric_continuation_legacy_alias_required'
          :'multiple_geometric_continuations_legacy_alias_required',
      promotionEligible:explicitP748.length===1
    },
    L2887:{
      candidateCount:lEval.length,
      candidates:lEval,
      explicitLegacyAliasMatches:explicitL2887.length,
      state:explicitL2887.length===1
        ?'explicit_legacy_alias_recovered'
        :'legacy_alias_not_present_in_current_attributes_archived_register_required',
      promotionEligible:explicitL2887.length===1
    },
    D234:{
      documentaryIdentityConfirmed:true,
      currentGisExactMatches:0,
      legacyRepositoryIdentified:Boolean(cfg.legacyEvidence.legacyGisRepository),
      publicLegacyFeatureExportLocated:cfg.legacyEvidence.legacyGisRepository.publicFeatureExportLocated,
      state:'legacy_kzn_dot_plan_or_register_export_required',
      promotionEligible:false
    },
    readiness:{
      allRoadIdentitiesResolved:false,
      nextAction:'obtain_public_or_authorized_kzn_dot_legacy_register_or_georeferenced_plan_extract'
    },
    policy:{
      ...cfg.policy,
      currentGeometryUsedForCandidateReductionOnly:true,
      noGeometricCandidatePromotedWithoutAlias:true,
      automaticRoadIdentityPromotion:false,
      automaticRouteCandidateCreation:false,
      canonicalMutation:false
    }
  };

  await writeFile(path.join(outDir,'legacy-recovery.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
  console.log('TN7_NATIONAL_27_R2_R6_RUNTIME_PASS');
  if(result.readiness.allRoadIdentitiesResolved) console.log('TN7_NATIONAL_27_R2_R6_LEGACY_READY');
  else console.log('TN7_NATIONAL_27_R2_R6_LEGACY_HOLD');
}

main().catch(error=>{
  console.error(JSON.stringify({event:'tn7_national_27_r2_r6_failed',error:String(error?.message||error)}));
  console.error('TN7_NATIONAL_27_R2_R6_RUNTIME_FAIL');
  process.exit(1);
});
