import { authenticateDiscoveryRequest } from './discovery-auth.mjs';
import { loadMobileDiscoveryPublication } from './mobile-discovery-publication.mjs';

export const MOBILE_DISCOVERY_PUBLICATION_PATH='/api/v1/publication/mobility/find-taxi';

const forbiddenCredentialQueryKeys=new Set(['access_token','id_token','token','authorization','bearer']);

function sendPrivate(res,status,payload){
  res.writeHead(status,{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'private, no-store',
    'x-content-type-options':'nosniff'
  });
  res.end(JSON.stringify(payload));
}

function queryContainsCredential(url){
  for(const key of url.searchParams.keys()){
    if(forbiddenCredentialQueryKeys.has(key.toLowerCase())) return true;
  }
  return false;
}

export async function handleMobileDiscoveryPublication({req,res,url,pool,env=process.env,now=()=>new Date()}){
  if((req.method || 'GET')!=='GET'){
    res.setHeader('allow','GET');
    sendPrivate(res,405,{error:'method_not_allowed'});
    return;
  }
  if(queryContainsCredential(url)){
    sendPrivate(res,401,{error:'credential_in_query_rejected'});
    return;
  }

  const auth=authenticateDiscoveryRequest(req,env,Math.floor(now().getTime()/1000));
  if(!auth.ok){
    sendPrivate(res,auth.status,{error:auth.error});
    return;
  }
  if(!pool){
    sendPrivate(res,503,{error:'publication_unavailable'});
    return;
  }

  try{
    const publication=await loadMobileDiscoveryPublication(pool,{now});
    sendPrivate(res,200,publication);
  }catch{
    console.error('mobile_discovery_publication_failed');
    sendPrivate(res,503,{error:'publication_unavailable'});
  }
}
