import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const cfg=JSON.parse(await readFile(new URL('./tn7-national-27-r2-r5-alias-recovery.json',import.meta.url),'utf8'));

const SOURCE={
  host:'giswebmaps1.kzncogta.gov.za',
  serviceUrl:'https://giswebmaps1.kzncogta.gov.za/server/rest/services/Base_map_18032022/FeatureServer',
  layerId:10,
  outFields:'OBJECTID,STR_NAME,STR_NAME_L,STREET,AG_R_NAME,ROAD_ID,MRRTE,OLD_STR,CATEGORY'
};
const MAX_BYTES=8*1024*1024;
const UMKHANYAKUDE_BBOX={xmin:31.8,ymin:-28.6,xmax:33.1,ymax:-26.7};

function sha256(buffer){return createHash('sha256').update(buffer).digest('hex');}

function assertOfficial(url){
  const u=new URL(url);
  if(u.protocol!=='https:'||u.hostname!==SOURCE.host) throw new Error('untrusted_official_source');
  return u;
}

function queryUrl(where,{geometry=false}={}){
  const u=assertOfficial(SOURCE.serviceUrl);
  u.pathname=u.pathname.replace(/\/$/,'')+'/'+SOURCE.layerId+'/query';
  u.search='';
  u.searchParams.set('where',where);
  u.searchParams.set('outFields',SOURCE.outFields);
  u.searchParams.set('returnGeometry',geometry?'true':'false');
  if(geometry){
    u.searchParams.set('outSR','4326');
    u.searchParams.set('f','geojson');
  }else{
    u.searchParams.set('f','json');
  }
  return u.toString();
}

async function fetchOfficial(url){
  assertOfficial(url);
  const response=await fetch(url,{
    headers:{'user-agent':'TenderizeTransportNetwork/2.0 TN7-NATIONAL-27-R2-R5 historical-alias-readonly'},
    redirect:'error',
    signal:AbortSignal.timeout(45000)
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

function canonicalCode(attrs={}){
  for(const key of ['STR_NAME','STREET','AG_R_NAME','ROAD_ID','OLD_STR']){
    const v=String(attrs[key]??'').trim();
    if(v && v!==' ') return v.replace(/\s+Road$/i,'').trim();
  }
  return '';
}

function exactCodeWhere(code){
  const q=String(code).replaceAll("'","''");
  const fields=['STR_NAME','STREET','AG_R_NAME','ROAD_ID','OLD_STR'];
  const parts=[];
  for(const field of fields){
    parts.push(`${field}='${q}'`);
    parts.push(`${field} LIKE '${q}/%'`);
    parts.push(`${field} LIKE '${q}-%'`);
  }
  const num=Number(q.replace(/^[A-Za-z]+/,''));
  if(Number.isFinite(num)) parts.push(`MRRTE=${num}`);
  return parts.join(' OR ');
}

function bboxContainsPoint([lon,lat],bbox){
  return lon>=bbox.xmin&&lon<=bbox.xmax&&lat>=bbox.ymin&&lat<=bbox.ymax;
}

function featureWithinBBox(feature,bbox){
  const g=feature.geometry;
  if(!g) return false;
  const coords=g.type==='LineString'?g.coordinates:(g.type==='MultiLineString'?(g.coordinates||[]).flat():[]);
  return coords.some(c=>Array.isArray(c)&&c.length>=2&&bboxContainsPoint(c,bbox));
}

function evaluateL2887(features){
  const exclude=new Set(cfg.documentaryElimination.L2887.excludeAliases);
  return features.map(f=>{
    const attrs=f.attributes||{};
    const code=canonicalCode(attrs);
    const explicitlyExcluded=exclude.has(code);
    return {
      objectId:attrs.OBJECTID??null,
      code:code||null,
      category:attrs.CATEGORY??null,
      excluded:explicitlyExcluded,
      reason:explicitlyExcluded?'documented_distinct_road':'historical_alias_not_proven'
    };
  });
}

async function main(){
  const outDir=path.resolve(process.env.NATIONAL27_R2_R5_DIR||'artifacts/tn7-national-27-r2-r5');
  await mkdir(outDir,{recursive:true});

  const lIds=[...new Set(cfg.r4State.L2887.remainingCandidateObjectIds)].sort((a,b)=>a-b);
  const lRows=await fetchOfficial(queryUrl(`OBJECTID IN (${lIds.join(',')})`));
  if(!Array.isArray(lRows.json.features)) throw new Error('unexpected_l2887_candidate_shape');
  const got=new Set(lRows.json.features.map(f=>Number(f.attributes?.OBJECTID)));
  const missing=lIds.filter(id=>!got.has(Number(id)));
  if(missing.length) throw new Error('r4_candidate_feature_missing:'+missing.join(','));

  const lEval=evaluateL2887(lRows.json.features);
  const lRemaining=lEval.filter(x=>!x.excluded);

  const exact={};
  for(const road of ['P748','L2887']){
    const r=await fetchOfficial(queryUrl(exactCodeWhere(road)));
    exact[road]={
      sourceUrl:r.url,
      sha256:r.checksum,
      bytes:r.bytes,
      featureCount:Array.isArray(r.json.features)?r.json.features.length:0,
      features:(r.json.features||[]).map(f=>({
        objectId:f.attributes?.OBJECTID??null,
        code:canonicalCode(f.attributes||{})||null,
        category:f.attributes?.CATEGORY??null
      }))
    };
  }

  const d234=await fetchOfficial(queryUrl(exactCodeWhere('D234'),{geometry:true}));
  if(d234.json.type!=='FeatureCollection'||!Array.isArray(d234.json.features)) throw new Error('unexpected_d234_geojson_shape');
  const d234Within=d234.json.features.filter(f=>featureWithinBBox(f,UMKHANYAKUDE_BBOX));
  const d234Outside=d234.json.features.length-d234Within.length;

  const p748Ready=exact.P748.featureCount===1;
  const l2887Ready=exact.L2887.featureCount===1;
  const d234Ready=d234Within.length===1;

  const result={
    gate:'TN7-NATIONAL-27-R2-R5',
    mode:'historical_alias_register_recovery_and_d234_corridor_expansion',
    source:{
      authority:'KwaZulu-Natal Department of Cooperative Governance and Traditional Affairs',
      l2887CandidateRevalidation:{
        sourceUrl:lRows.url,sha256:lRows.checksum,bytes:lRows.bytes,featureCount:lRows.json.features.length
      },
      exactCodeProbes:exact,
      d234Probe:{
        sourceUrl:d234.url,sha256:d234.checksum,bytes:d234.bytes,
        totalFeatureCount:d234.json.features.length,
        withinUmkhanyakudeFeatureCount:d234Within.length,
        outsideUmkhanyakudeFeatureCount:d234Outside
      }
    },
    historicalCrosswalkEvidence:cfg.historicalCrosswalkEvidence,
    resolution:{
      P748:{
        exactCurrentGisMatches:exact.P748.featureCount,
        state:p748Ready?'exact_current_gis_identity_recovered':'historical_alias_register_still_required',
        promotionEligible:p748Ready
      },
      L2887:{
        startingR4Candidates:lEval.length,
        documentaryExcluded:lEval.filter(x=>x.excluded).length,
        remainingAliasCandidates:lRemaining.length,
        candidates:lEval,
        exactCurrentGisMatches:exact.L2887.featureCount,
        state:l2887Ready?'exact_current_gis_identity_recovered':
          lRemaining.length===0?'candidate_set_exhausted_historical_alias_register_required':
          'historical_alias_register_still_required',
        promotionEligible:l2887Ready
      },
      D234:{
        totalCurrentGisMatches:d234.json.features.length,
        withinDocumentedCorridorMatches:d234Within.length,
        outsideCorridorRejected:d234Outside,
        state:d234Ready?'unique_umkhanyakude_spatial_identity_recovered':
          d234Within.length===0?'current_gis_has_no_umkhanyakude_d234_historical_source_required':
          'multiple_umkhanyakude_d234_candidates',
        promotionEligible:d234Ready
      },
      allRoadIdentitiesResolved:p748Ready&&l2887Ready&&d234Ready
    },
    policy:{
      ...cfg.policy,
      currentGisExactCodeProbeDoesNotCreateHistoricalAlias:true,
      unrelatedD234OutsideUmkhanyakudeRejected:true,
      automaticRoadIdentityPromotion:false,
      automaticRouteCandidateCreation:false,
      canonicalMutation:false
    }
  };

  await writeFile(path.join(outDir,'alias-recovery.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
  console.log('TN7_NATIONAL_27_R2_R5_RUNTIME_PASS');
  if(result.resolution.allRoadIdentitiesResolved) console.log('TN7_NATIONAL_27_R2_R5_ALIAS_READY');
  else console.log('TN7_NATIONAL_27_R2_R5_ALIAS_HOLD');
}

main().catch(error=>{
  console.error(JSON.stringify({event:'tn7_national_27_r2_r5_failed',error:String(error?.message||error)}));
  console.error('TN7_NATIONAL_27_R2_R5_RUNTIME_FAIL');
  process.exit(1);
});
