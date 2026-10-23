import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  verifyOperatorToken,
  authenticateOperatorRequest,
  operatorAuthCapabilities
} from '../apps/transport-api/src/operator-auth.mjs';

function b64url(value){
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g,'')
    .replace(/\+/g,'-')
    .replace(/\//g,'_');
}

function sign(payload,secret,header={alg:'HS256',typ:'JWT'}){
  const encodedHeader=b64url(JSON.stringify(header));
  const encodedPayload=b64url(JSON.stringify(payload));
  const signature=createHmac('sha256',secret)
    .update(encodedHeader+'.'+encodedPayload)
    .digest('base64')
    .replace(/=/g,'')
    .replace(/\+/g,'-')
    .replace(/\//g,'_');
  return encodedHeader+'.'+encodedPayload+'.'+signature;
}

function assert(condition,label){
  if(!condition) throw new Error('FAIL '+label);
  console.log('PASS '+label);
}

const secret='tn7-auth-test-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
const issuer='tenderize-iam-test';
const audience='transport-network-operator-test';
const now=2_000_000_000;

const env={
  OPERATOR_JWT_SECRET:secret,
  OPERATOR_JWT_ISSUER:issuer,
  OPERATOR_JWT_AUDIENCE:audience,
  OPERATOR_JWT_CLOCK_SKEW_SECONDS:'30'
};

const reviewerPayload={
  iss:issuer,
  aud:audience,
  sub:'operator-reviewer-1',
  name:'TN7 Reviewer',
  roles:['reviewer'],
  iat:now-10,
  exp:now+300,
  jti:'reviewer-token-1'
};

const valid=verifyOperatorToken(sign(reviewerPayload,secret),env,now);
assert(valid.ok===true,'valid reviewer token accepted');
assert(valid.actor.subject==='operator-reviewer-1','trusted subject preserved');
assert(valid.actor.roles.length===1 && valid.actor.roles[0]==='reviewer','reviewer role preserved');

assert(
  verifyOperatorToken(sign({...reviewerPayload,exp:now-100},secret),env,now).error==='operator_token_expired',
  'expired token rejected'
);
assert(
  verifyOperatorToken(sign({...reviewerPayload,iss:'wrong-issuer'},secret),env,now).error==='invalid_operator_issuer',
  'wrong issuer rejected'
);
assert(
  verifyOperatorToken(sign({...reviewerPayload,aud:'wrong-audience'},secret),env,now).error==='invalid_operator_audience',
  'wrong audience rejected'
);
assert(
  verifyOperatorToken(sign({...reviewerPayload,roles:['unknown']},secret),env,now).status===403,
  'unknown role rejected'
);
assert(
  verifyOperatorToken(sign({...reviewerPayload,nbf:now+600},secret),env,now).error==='operator_token_not_active',
  'not-yet-active token rejected'
);
assert(
  verifyOperatorToken(sign({...reviewerPayload,iat:now+600},secret),env,now).error==='operator_token_issued_in_future',
  'future-issued token rejected'
);
assert(
  verifyOperatorToken(sign(reviewerPayload,secret,{alg:'none',typ:'JWT'}),env,now).error==='unsupported_operator_token',
  'non-HS256 algorithm rejected'
);

const badSignature=sign(reviewerPayload,secret).slice(0,-2)+'xx';
assert(
  verifyOperatorToken(badSignature,env,now).status===401,
  'bad signature rejected'
);

assert(
  verifyOperatorToken(sign(reviewerPayload,'short-secret'),{
    ...env,
    OPERATOR_JWT_SECRET:'short-secret'
  },now).error==='operator_auth_unconfigured',
  'short verifier secret fails closed'
);

const original={
  secret:process.env.OPERATOR_JWT_SECRET,
  issuer:process.env.OPERATOR_JWT_ISSUER,
  audience:process.env.OPERATOR_JWT_AUDIENCE
};

try{
  process.env.OPERATOR_JWT_SECRET=secret;
  process.env.OPERATOR_JWT_ISSUER=issuer;
  process.env.OPERATOR_JWT_AUDIENCE=audience;

  const liveNow=Math.floor(Date.now()/1000);
  const liveReviewer=sign({
    iss:issuer,aud:audience,sub:'reviewer-live',roles:['reviewer'],iat:liveNow-5,exp:liveNow+300
  },secret);

  const reviewerReq={headers:{authorization:'Bearer '+liveReviewer}};
  assert(
    authenticateOperatorRequest(reviewerReq,['reviewer','approver','admin']).ok===true,
    'reviewer may access protected read queue'
  );
  assert(
    authenticateOperatorRequest(reviewerReq,['approver','admin']).status===403,
    'reviewer blocked from mutation boundary'
  );

  const approver=sign({
    iss:issuer,aud:audience,sub:'approver-live',roles:['approver'],iat:liveNow-5,exp:liveNow+300
  },secret);
  assert(
    authenticateOperatorRequest({headers:{authorization:'Bearer '+approver}},['approver','admin']).ok===true,
    'approver eligible for future mutation boundary'
  );

  assert(
    authenticateOperatorRequest({headers:{}},['reviewer']).status===401,
    'missing bearer token rejected'
  );

  const capabilities=operatorAuthCapabilities();
  assert(capabilities.configured===true,'operator auth reports configured');
  assert(capabilities.mutationEnabled===false,'operator auth reports mutations disabled');
}finally{
  if(original.secret===undefined) delete process.env.OPERATOR_JWT_SECRET;
  else process.env.OPERATOR_JWT_SECRET=original.secret;
  if(original.issuer===undefined) delete process.env.OPERATOR_JWT_ISSUER;
  else process.env.OPERATOR_JWT_ISSUER=original.issuer;
  if(original.audience===undefined) delete process.env.OPERATOR_JWT_AUDIENCE;
  else process.env.OPERATOR_JWT_AUDIENCE=original.audience;
}

const api=readFileSync('apps/transport-api/src/server.mjs','utf8');
const web=readFileSync('live/server.mjs','utf8');
const migration=readFileSync('db/005_operator_audit.sql','utf8');
const audit=readFileSync('apps/transport-api/src/operator-audit.mjs','utf8');

assert(api.includes("'/api/v1/operator/me'"),'operator identity route exists');
assert(api.includes("'/api/v1/operator/quality-queue'"),'authenticated quality queue exists');
assert(api.includes("url.pathname.startsWith('/api/v1/operator/adjudications/')"),'future mutation boundary exists');
assert(api.includes("operatorAuthOrSend(req,res,['approver','admin'])"),'mutation boundary requires approver/admin');
assert(api.includes("operatorAuthOrSend(req,res,['reviewer','approver','admin'])"),'operator reads require recognised role');
assert(api.includes("if(url.pathname==='/api/v1/data-issues')"),'detailed data issue route retained');
assert(api.includes("if(url.pathname==='/api/v1/reconciliation/rank-candidates')"),'reconciliation queue retained');
assert(!web.includes("'/api/v1/operator/me'"),'public Web does not proxy operator identity');
assert(!web.includes("'/api/v1/operator/quality-queue'"),'public Web does not proxy operator quality queue');
assert(!web.includes("'/api/v1/data-issues'"),'public Web does not proxy detailed data issues');
assert(!web.includes("'/api/v1/reconciliation/rank-candidates'"),'public Web does not proxy reconciliation queue');
assert(migration.includes('BEFORE UPDATE OR DELETE ON operator_audit_event'),'audit rows are immutable by trigger');
assert(migration.includes('operator_audit_event_idempotency_idx'),'audit idempotency index exists');
assert(!migration.includes('DROP TABLE'),'audit migration is additive');
assert(audit.includes('INSERT INTO operator_audit_event'),'audit writer is append-only');
assert(!audit.includes('UPDATE operator_audit_event'),'audit writer cannot update audit rows');
assert(!audit.includes('DELETE FROM operator_audit_event'),'audit writer cannot delete audit rows');
assert(!api.includes('005_operator_audit.sql'),'application startup does not run audit migration');

console.log('TN7_AUTH_STATIC_PASS');
