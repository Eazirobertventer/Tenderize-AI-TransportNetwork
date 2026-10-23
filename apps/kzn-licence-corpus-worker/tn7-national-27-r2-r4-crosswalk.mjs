import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const cfg=JSON.parse(await readFile(new URL('./tn7-national-27-r2-r4-crosswalk.json',import.meta.url),'utf8'));
const SOURCE={
  host:'giswebmaps1.kzncogta.gov.za',
  serviceUrl:'https://giswebmaps1.kzncogta.gov.za/server/rest/services/Base_map_18032022/FeatureServer',
  layerId:10,
  outFields:'OBJECTID,STR_NAME,STR_NAME_L,STREET,AG_R_NAME,ROAD_ID,MRRTE,OLD_STR,CATEGORY'
};
const MAX_BYTES=8*1024*1024;

function sha256(buffer){return createHash('sha256').update(buffer).digest('hex');}
function assertOfficial(url){
  const u=new URL(url);
  if(u.protocol!=='https:'||u.hostname!==SOURCE.host) throw new Error('untrusted_official_source');
  return u;
}
function idsQuery(ids){
  const u=assertOfficial(SOURCE.serviceUrl);
  u.pathname=u.pathname.replace(/\/$/,'')+'/'+SOURCE.layerId+'/query';
  u.search='';
  u.searchParams.set('where',`OBJECTID IN (${ids.join(',')})`);
  u.searchParams.set('outFields',SOURCE.outFields);
  u.searchParams.set('returnGeometry','false');
  u.searchParams.set('f','json');
  return u.toString();
}
async function fetchOfficial(url){
  assertOfficial(url);
  const response=await fetch(url,{
    headers:{'user-agent':'TenderizeTransportNetwork/2.0 TN7-NATIONAL-27-R2-R4 documentary-crosswalk-readonly'},
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
  if(!Array.isArray(json.features)) throw new Error('unexpected_arcgis_shape');
  return {json,buffer,checksum:sha256(buffer),bytes:buffer.length,url};
}
function canonicalCode(feature){
  const a=feature.attributes||{};
  for(const key of ['STR_NAME','STREET','AG_R_NAME','ROAD_ID','OLD_STR']){
    const v=String(a[key]??'').trim();
    if(v && v!==' ') return v.replace(/\s+Road$/i,'').trim();
  }
  return '';
}
function prefix(code){
  const m=String(code).trim().match(/^([A-Za-z]+)/);
  return m?m[1].toUpperCase():'';
}
function eliminateP748(feature){
  const code=canonicalCode(feature);
  if(!code) return {excluded:false,reason:'unlabelled_authoritative_feature'};
  if(/^P748(?:\b|\/|-)/i.test(code)) return {excluded:false,reason:'literal_or_sectional_P748'};
  if(cfg.candidateElimination.P748.knownDifferentProvincialCodesToReject.includes(code)){
    return {excluded:true,reason:'known_different_provincial_code'};
  }
  if(cfg.candidateElimination.P748.knownDifferentCodePrefixesToReject.includes(prefix(code))){
    return {excluded:true,reason:'known_different_road_class_code'};
  }
  if(/^P\d+/i.test(code)) return {excluded:true,reason:'known_different_provincial_code'};
  return {excluded:false,reason:'unresolved_alias_or_nonstandard_code'};
}
function eliminateL2887(feature){
  const code=canonicalCode(feature);
  if(!code) return {excluded:false,reason:'unlabelled_authoritative_feature'};
  if(/^L2887(?:\b|\/|-)/i.test(code)) return {excluded:false,reason:'literal_or_sectional_L2887'};
  if(cfg.candidateElimination.L2887.knownDifferentLocalCodesToReject.includes(code)){
    return {excluded:true,reason:'known_different_local_code'};
  }
  if(cfg.candidateElimination.L2887.knownDifferentCodePrefixesToReject.includes(prefix(code))){
    return {excluded:true,reason:'known_different_road_class_code'};
  }
  if(/^L\d+/i.test(code)) return {excluded:true,reason:'known_different_local_code'};
  return {excluded:false,reason:'unresolved_alias_or_nonstandard_code'};
}
function evaluate(road,features,fn){
  return features.map(feature=>{
    const attributes=feature.attributes||{};
    const elimination=fn(feature);
    return {
      objectId:attributes.OBJECTID??null,
      code:canonicalCode(feature)||null,
      category:attributes.CATEGORY??null,
      excluded:elimination.excluded,
      reason:elimination.reason
    };
  });
}
async function main(){
  const outDir=path.resolve(process.env.NATIONAL27_R2_R4_DIR||'artifacts/tn7-national-27-r2-r4');
  await mkdir(outDir,{recursive:true});
  const allIds=[...new Set([
    ...cfg.candidateElimination.P748.r3ObjectIds,
    ...cfg.candidateElimination.L2887.r3ObjectIds
  ])].sort((a,b)=>a-b);

  const acquired=await fetchOfficial(idsQuery(allIds));
  const byId=new Map(acquired.json.features.map(f=>[Number(f.attributes?.OBJECTID),f]));
  const missingIds=allIds.filter(id=>!byId.has(Number(id)));
  if(missingIds.length) throw new Error('r3_candidate_feature_missing:'+missingIds.join(','));

  const pFeatures=cfg.candidateElimination.P748.r3ObjectIds.map(id=>byId.get(Number(id)));
  const lFeatures=cfg.candidateElimination.L2887.r3ObjectIds.map(id=>byId.get(Number(id)));

  const pEval=evaluate('P748',pFeatures,eliminateP748);
  const lEval=evaluate('L2887',lFeatures,eliminateL2887);
  const pRemaining=pEval.filter(x=>!x.excluded);
  const lRemaining=lEval.filter(x=>!x.excluded);

  const result={
    gate:'TN7-NATIONAL-27-R2-R4',
    mode:'provincial_road_code_crosswalk_documentary_candidate_elimination',
    source:{
      authority:'KwaZulu-Natal Department of Cooperative Governance and Traditional Affairs',
      sourceUrl:acquired.url,
      sha256:acquired.checksum,
      bytes:acquired.bytes,
      featureCount:acquired.json.features.length
    },
    documentaryCrosswalk:cfg.documentaryCrosswalk,
    elimination:{
      P748:{
        startingCandidates:pEval.length,
        excluded:pEval.filter(x=>x.excluded).length,
        remaining:pRemaining.length,
        candidates:pEval,
        state:pRemaining.length===1?'single_unresolved_alias_candidate':
          pRemaining.length===0?'r3_candidate_set_exhausted_crosswalk_source_required':
          'multiple_unresolved_alias_candidates'
      },
      L2887:{
        startingCandidates:lEval.length,
        excluded:lEval.filter(x=>x.excluded).length,
        remaining:lRemaining.length,
        candidates:lEval,
        state:lRemaining.length===1?'single_unresolved_alias_candidate':
          lRemaining.length===0?'r3_candidate_set_exhausted_crosswalk_source_required':
          'multiple_unresolved_alias_candidates'
      },
      D234:{
        startingCandidates:0,
        excluded:0,
        remaining:0,
        state:'gazette_identity_confirmed_spatial_crosswalk_source_required'
      }
    },
    readiness:{
      P748:false,
      L2887:false,
      D234:false,
      allRoadIdentitiesResolved:false,
      nextAction:'recover_historical_or_official_alias_crosswalk_for_exhausted_codes'
    },
    policy:{
      ...cfg.policy,
      documentaryEliminationApplied:true,
      noCandidateRenamedByTopology:true,
      automaticRoadIdentityPromotion:false,
      automaticRouteCandidateCreation:false,
      canonicalMutation:false
    }
  };

  await writeFile(path.join(outDir,'crosswalk-resolution.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
  console.log('TN7_NATIONAL_27_R2_R4_RUNTIME_PASS');
  if(result.readiness.allRoadIdentitiesResolved) console.log('TN7_NATIONAL_27_R2_R4_CROSSWALK_READY');
  else console.log('TN7_NATIONAL_27_R2_R4_CROSSWALK_HOLD');
}

main().catch(error=>{
  console.error(JSON.stringify({event:'tn7_national_27_r2_r4_failed',error:String(error?.message||error)}));
  console.error('TN7_NATIONAL_27_R2_R4_RUNTIME_FAIL');
  process.exit(1);
});
