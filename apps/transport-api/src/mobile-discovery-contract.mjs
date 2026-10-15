const allowedFreshness=new Set(['live','delayed','stale','unavailable']);
const allowedPublication=new Set(['published','withheld']);

function exactKeys(value,allowed,path){
  if(!value || typeof value!=='object' || Array.isArray(value)) throw new Error(path+'_object_required');
  for(const key of Object.keys(value)){
    if(!allowed.includes(key)) throw new Error(path+'_unknown_key_'+key);
  }
}

function id(value,path){
  if(typeof value!=='string' || value.length===0 || value!==value.trim()) throw new Error(path+'_invalid_id');
}

function label(value,path){
  if(typeof value!=='string' || value.trim().length===0) throw new Error(path+'_invalid_label');
}

function optionalLabel(value,path){
  if(value!==undefined) label(value,path);
}

function timestampValue(value,path){
  if(value!==null && (typeof value!=='string' || value.length===0)) throw new Error(path+'_invalid_timestamp');
}

function timestamps(value,path){
  exactKeys(value,['publishedAt','sourceDataThrough','lastSuccessfulSyncAt'],path);
  timestampValue(value.publishedAt,path+'.publishedAt');
  timestampValue(value.sourceDataThrough,path+'.sourceDataThrough');
  timestampValue(value.lastSuccessfulSyncAt,path+'.lastSuccessfulSyncAt');
}

function coordinate(value,path){
  exactKeys(value,['latitude','longitude'],path);
  if(!Number.isFinite(value.latitude) || value.latitude < -90 || value.latitude > 90) throw new Error(path+'_invalid_latitude');
  if(!Number.isFinite(value.longitude) || value.longitude < -180 || value.longitude > 180) throw new Error(path+'_invalid_longitude');
}

function rank(value,path){
  exactKeys(value,['rankId','name','localityLabel','coordinate','publication'],path);
  id(value.rankId,path+'.rankId');
  label(value.name,path+'.name');
  optionalLabel(value.localityLabel,path+'.localityLabel');
  if(value.coordinate!==undefined) coordinate(value.coordinate,path+'.coordinate');
  if(value.publication!==undefined && !allowedPublication.has(value.publication)) throw new Error(path+'_invalid_publication');
}

function association(value,path){
  exactKeys(value,['associationId','displayName'],path);
  id(value.associationId,path+'.associationId');
  label(value.displayName,path+'.displayName');
}

function route(value,index){
  const path='routes['+index+']';
  exactKeys(value,['routeId','originRank','destinationRank','associations','routeCode','routeName','publication','freshness'],path);
  id(value.routeId,path+'.routeId');
  rank(value.originRank,path+'.originRank');
  rank(value.destinationRank,path+'.destinationRank');
  if(value.originRank.rankId===value.destinationRank.rankId) throw new Error(path+'_same_endpoint');
  if(value.associations!==undefined){
    if(!Array.isArray(value.associations)) throw new Error(path+'_associations_array_required');
    const ids=new Set();
    value.associations.forEach((item,i)=>{
      association(item,path+'.associations['+i+']');
      if(ids.has(item.associationId)) throw new Error(path+'_duplicate_association');
      ids.add(item.associationId);
    });
  }
  optionalLabel(value.routeCode,path+'.routeCode');
  optionalLabel(value.routeName,path+'.routeName');
  if(value.publication!==undefined && !allowedPublication.has(value.publication)) throw new Error(path+'_invalid_publication');
  if(value.freshness!==undefined && !allowedFreshness.has(value.freshness)) throw new Error(path+'_invalid_freshness');
}

export function validateTransportDiscoveryDocument(value){
  try{
    exactKeys(value,['kind','provenance','freshness','timestamps','routes'],'document');
    if(value.kind!=='fairpay-transport-discovery') throw new Error('document_invalid_kind');
    if(value.provenance!=='canonical-fairpay-transport') throw new Error('document_invalid_provenance');
    if(!allowedFreshness.has(value.freshness)) throw new Error('document_invalid_freshness');
    timestamps(value.timestamps,'timestamps');
    if(!Array.isArray(value.routes)) throw new Error('document_routes_array_required');
    const routeIds=new Set();
    value.routes.forEach((item,index)=>{
      route(item,index);
      if(routeIds.has(item.routeId)) throw new Error('document_duplicate_route_id');
      routeIds.add(item.routeId);
    });
    return {ok:true,value};
  }catch(error){
    return {ok:false,error:error instanceof Error ? error.message : 'contract_invalid'};
  }
}

export function assertTransportDiscoveryDocument(value){
  const result=validateTransportDiscoveryDocument(value);
  if(!result.ok) throw new Error('publication_contract_invalid:'+result.error);
  return result.value;
}
