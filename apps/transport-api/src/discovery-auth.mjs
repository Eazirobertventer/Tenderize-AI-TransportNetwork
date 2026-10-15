import { createHmac, timingSafeEqual } from 'node:crypto';

export const DISCOVERY_AUDIENCE='transport-network-discovery';
export const DISCOVERY_SCOPE='transport.discovery.read';

function base64UrlDecode(value){
  if(typeof value!=='string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid_base64url');
  const normalized=value.replace(/-/g,'+').replace(/_/g,'/');
  const padded=normalized+'='.repeat((4-normalized.length%4)%4);
  return Buffer.from(padded,'base64');
}

function parseJsonSegment(value){
  return JSON.parse(base64UrlDecode(value).toString('utf8'));
}

function audienceMatches(value,expected){
  if(typeof value==='string') return value===expected;
  return Array.isArray(value) && value.includes(expected);
}

function normalizeScopes(value){
  const scopes=Array.isArray(value)
    ? value
    : typeof value==='string'
      ? value.split(/[ ,]+/)
      : [];
  return new Set(scopes.filter(item=>typeof item==='string' && item.length>0));
}

export function discoveryAuthConfig(env=process.env){
  const issuer=env.DISCOVERY_JWT_ISSUER || 'tenderize-iam';
  const audience=env.DISCOVERY_JWT_AUDIENCE || DISCOVERY_AUDIENCE;
  const secret=env.DISCOVERY_JWT_SECRET || '';
  const skewRaw=Number(env.DISCOVERY_JWT_CLOCK_SKEW_SECONDS || 30);
  const clockSkewSeconds=Number.isFinite(skewRaw) ? Math.max(0,Math.min(300,Math.floor(skewRaw))) : 30;
  return {
    issuer,
    audience,
    secret,
    requiredScope:DISCOVERY_SCOPE,
    clockSkewSeconds,
    configured:Buffer.byteLength(secret,'utf8')>=32
  };
}

export function verifyDiscoveryToken(token,env=process.env,nowSeconds=Math.floor(Date.now()/1000)){
  const config=discoveryAuthConfig(env);
  if(!config.configured) return {ok:false,status:503,error:'discovery_auth_unconfigured'};
  if(typeof token!=='string' || token.length<20 || token.length>8192){
    return {ok:false,status:401,error:'invalid_discovery_token'};
  }

  const parts=token.split('.');
  if(parts.length!==3 || parts.some(part=>!part)) return {ok:false,status:401,error:'invalid_discovery_token'};

  let header;
  let payload;
  let suppliedSignature;
  try{
    header=parseJsonSegment(parts[0]);
    payload=parseJsonSegment(parts[1]);
    suppliedSignature=base64UrlDecode(parts[2]);
  }catch{
    return {ok:false,status:401,error:'invalid_discovery_token'};
  }

  if(header?.alg!=='HS256' || (header.typ && header.typ!=='JWT')){
    return {ok:false,status:401,error:'unsupported_discovery_token'};
  }

  const expectedSignature=createHmac('sha256',config.secret)
    .update(parts[0]+'.'+parts[1])
    .digest();
  if(suppliedSignature.length!==expectedSignature.length || !timingSafeEqual(suppliedSignature,expectedSignature)){
    return {ok:false,status:401,error:'invalid_discovery_signature'};
  }
  if(payload?.iss!==config.issuer) return {ok:false,status:401,error:'invalid_discovery_issuer'};
  if(!audienceMatches(payload?.aud,config.audience)) return {ok:false,status:401,error:'invalid_discovery_audience'};
  if(typeof payload?.sub!=='string' || !payload.sub.trim()) return {ok:false,status:401,error:'invalid_discovery_subject'};
  if(!Number.isFinite(payload?.exp) || nowSeconds>payload.exp+config.clockSkewSeconds){
    return {ok:false,status:401,error:'discovery_token_expired'};
  }
  if(Number.isFinite(payload?.nbf) && nowSeconds+config.clockSkewSeconds<payload.nbf){
    return {ok:false,status:401,error:'discovery_token_not_active'};
  }
  if(Number.isFinite(payload?.iat) && payload.iat>nowSeconds+config.clockSkewSeconds){
    return {ok:false,status:401,error:'discovery_token_issued_in_future'};
  }

  const scopes=normalizeScopes(payload.scope ?? payload.scopes);
  if(!scopes.has(config.requiredScope)){
    return {ok:false,status:403,error:'discovery_scope_required'};
  }

  return {
    ok:true,
    status:200,
    principal:{
      subject:payload.sub.trim(),
      issuer:payload.iss,
      audience:config.audience,
      scopes:[...scopes],
      tokenId:typeof payload.jti==='string' ? payload.jti.slice(0,200) : null
    }
  };
}

function authorizationHeaderCount(rawHeaders=[]){
  let count=0;
  for(let i=0;i<rawHeaders.length;i+=2){
    if(String(rawHeaders[i] || '').toLowerCase()==='authorization') count+=1;
  }
  return count;
}

export function authenticateDiscoveryRequest(req,env=process.env,nowSeconds=Math.floor(Date.now()/1000)){
  const config=discoveryAuthConfig(env);
  if(!config.configured) return {ok:false,status:503,error:'discovery_auth_unconfigured'};
  if(authorizationHeaderCount(req.rawHeaders)>1) return {ok:false,status:401,error:'invalid_discovery_token'};
  const auth=req.headers?.authorization;
  if(typeof auth!=='string' || !auth.startsWith('Bearer ')){
    return {ok:false,status:401,error:'discovery_auth_required'};
  }
  return verifyDiscoveryToken(auth.slice(7).trim(),env,nowSeconds);
}
