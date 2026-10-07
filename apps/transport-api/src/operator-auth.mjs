import { createHmac, timingSafeEqual } from 'node:crypto';

const allowedRoles=new Set(['reviewer','approver','admin']);

function base64UrlDecode(value){
  if(typeof value!=='string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid_base64url');
  const normalized=value.replace(/-/g,'+').replace(/_/g,'/');
  const padded=normalized+'='.repeat((4-normalized.length%4)%4);
  return Buffer.from(padded,'base64');
}

function parseJsonSegment(value){
  const decoded=base64UrlDecode(value).toString('utf8');
  return JSON.parse(decoded);
}

function audienceMatches(value,expected){
  if(typeof value==='string') return value===expected;
  return Array.isArray(value) && value.includes(expected);
}

function normalizeRoles(value){
  const roles=Array.isArray(value) ? value : typeof value==='string' ? value.split(/[ ,]+/) : [];
  return [...new Set(roles.filter(role=>allowedRoles.has(role)))];
}

export function operatorAuthConfig(env=process.env){
  const issuer=env.OPERATOR_JWT_ISSUER || 'tenderize-iam';
  const audience=env.OPERATOR_JWT_AUDIENCE || 'transport-network-operator';
  const secret=env.OPERATOR_JWT_SECRET || '';
  const skewRaw=Number(env.OPERATOR_JWT_CLOCK_SKEW_SECONDS || 30);
  const clockSkewSeconds=Number.isFinite(skewRaw) ? Math.max(0,Math.min(300,Math.floor(skewRaw))) : 30;
  return {
    issuer,
    audience,
    secret,
    clockSkewSeconds,
    configured:Buffer.byteLength(secret,'utf8')>=32
  };
}

export function verifyOperatorToken(token,env=process.env,nowSeconds=Math.floor(Date.now()/1000)){
  const config=operatorAuthConfig(env);
  if(!config.configured){
    return {ok:false,status:503,error:'operator_auth_unconfigured'};
  }

  if(typeof token!=='string' || token.length<20 || token.length>8192){
    return {ok:false,status:401,error:'invalid_operator_token'};
  }

  const parts=token.split('.');
  if(parts.length!==3 || parts.some(part=>!part)){
    return {ok:false,status:401,error:'invalid_operator_token'};
  }

  let header;
  let payload;
  let suppliedSignature;
  try{
    header=parseJsonSegment(parts[0]);
    payload=parseJsonSegment(parts[1]);
    suppliedSignature=base64UrlDecode(parts[2]);
  }catch{
    return {ok:false,status:401,error:'invalid_operator_token'};
  }

  if(header?.alg!=='HS256' || (header.typ && header.typ!=='JWT')){
    return {ok:false,status:401,error:'unsupported_operator_token'};
  }

  const expectedSignature=createHmac('sha256',config.secret)
    .update(parts[0]+'.'+parts[1])
    .digest();

  if(suppliedSignature.length!==expectedSignature.length ||
      !timingSafeEqual(suppliedSignature,expectedSignature)){
    return {ok:false,status:401,error:'invalid_operator_signature'};
  }

  if(payload?.iss!==config.issuer){
    return {ok:false,status:401,error:'invalid_operator_issuer'};
  }

  if(!audienceMatches(payload?.aud,config.audience)){
    return {ok:false,status:401,error:'invalid_operator_audience'};
  }

  if(typeof payload?.sub!=='string' || !payload.sub.trim()){
    return {ok:false,status:401,error:'invalid_operator_subject'};
  }

  if(!Number.isFinite(payload?.exp) || nowSeconds>payload.exp+config.clockSkewSeconds){
    return {ok:false,status:401,error:'operator_token_expired'};
  }

  if(Number.isFinite(payload?.nbf) && nowSeconds+config.clockSkewSeconds<payload.nbf){
    return {ok:false,status:401,error:'operator_token_not_active'};
  }

  if(Number.isFinite(payload?.iat) && payload.iat>nowSeconds+config.clockSkewSeconds){
    return {ok:false,status:401,error:'operator_token_issued_in_future'};
  }

  const roles=normalizeRoles(payload.roles ?? payload.role);
  if(!roles.length){
    return {ok:false,status:403,error:'operator_role_required'};
  }

  return {
    ok:true,
    status:200,
    actor:{
      subject:payload.sub.trim(),
      displayName:typeof payload.name==='string' ? payload.name.trim().slice(0,200) : null,
      email:typeof payload.email==='string' ? payload.email.trim().slice(0,320) : null,
      roles,
      tokenId:typeof payload.jti==='string' ? payload.jti.slice(0,200) : null,
      issuer:payload.iss,
      audience:config.audience
    },
    claims:{
      exp:payload.exp,
      iat:Number.isFinite(payload.iat)?payload.iat:null,
      nbf:Number.isFinite(payload.nbf)?payload.nbf:null
    }
  };
}

export function authenticateOperatorRequest(req,allowed=[]){
  const config=operatorAuthConfig();
  if(!config.configured){
    return {ok:false,status:503,error:'operator_auth_unconfigured'};
  }

  const auth=req.headers?.authorization;
  if(typeof auth!=='string' || !auth.startsWith('Bearer ')){
    return {ok:false,status:401,error:'operator_auth_required'};
  }

  const result=verifyOperatorToken(auth.slice(7).trim());
  if(!result.ok) return result;

  if(allowed.length && !result.actor.roles.some(role=>allowed.includes(role))){
    return {
      ok:false,
      status:403,
      error:'operator_role_forbidden',
      requiredRoles:allowed
    };
  }

  return result;
}

export function operatorAuthCapabilities(env=process.env){
  const config=operatorAuthConfig(env);
  const deferIssueEnabled=env.OPERATOR_DEFER_ISSUE_ENABLED==='true';
  const rejectIssueEnabled=env.OPERATOR_REJECT_ISSUE_ENABLED==='true';
  const reopenIssueEnabled=env.OPERATOR_REOPEN_ISSUE_ENABLED==='true';
  const dualControlEnabled=env.OPERATOR_DUAL_CONTROL_ENABLED==='true';
  const aliasPromotionEnabled=env.OPERATOR_ALIAS_PROMOTION_ENABLED==='true';
  const associationAssignmentEnabled=env.OPERATOR_ASSOCIATION_ASSIGNMENT_ENABLED==='true';
  const routePromotionEnabled=env.OPERATOR_ROUTE_PROMOTION_ENABLED==='true';
  const rankMergeEnabled=env.OPERATOR_RANK_MERGE_ENABLED==='true';
  const enabledActions=[];
  if(deferIssueEnabled) enabledActions.push('data_issue.defer');
  if(rejectIssueEnabled) enabledActions.push('data_issue.reject');
  if(reopenIssueEnabled) enabledActions.push('data_issue.reopen');
  if(dualControlEnabled) enabledActions.push('decision_proposal.create','decision_proposal.approve','decision_proposal.reject','decision_proposal.withdraw');
  if(dualControlEnabled && aliasPromotionEnabled) enabledActions.push('taxi_rank.alias.add','taxi_association.alias.add');
  if(dualControlEnabled && associationAssignmentEnabled) enabledActions.push('taxi_rank_association.assign');
  if(dualControlEnabled && routePromotionEnabled) enabledActions.push('taxi_route.promote');
  if(dualControlEnabled && rankMergeEnabled) enabledActions.push('taxi_rank.merge');

  return {
    configured:config.configured,
    scheme:'Bearer',
    algorithm:'HS256',
    issuer:config.issuer,
    audience:config.audience,
    roles:[...allowedRoles],
    mutationEnabled:enabledActions.length>0,
    adjudication:{
      deferIssueEnabled,
      rejectIssueEnabled,
      reopenIssueEnabled,
      dualControlEnabled,
      aliasPromotionEnabled,
      associationAssignmentEnabled,
      routePromotionEnabled,
      rankMergeEnabled,
      enabledActions
    }
  };
}
