import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyDiscoveryToken } from '../apps/transport-api/src/discovery-auth.mjs';
import { verifyOperatorToken } from '../apps/transport-api/src/operator-auth.mjs';

function enc(value){return Buffer.from(JSON.stringify(value)).toString('base64url');}
function jwt(payload,secret){
  const head=enc({alg:'HS256',typ:'JWT'});
  const body=enc(payload);
  const sig=createHmac('sha256',secret).update(head+'.'+body).digest('base64url');
  return head+'.'+body+'.'+sig;
}

const now=1_800_000_000;
const discoverySecret='d'.repeat(48);
const operatorSecret='o'.repeat(48);
const discoveryEnv={DISCOVERY_JWT_SECRET:discoverySecret,DISCOVERY_JWT_ISSUER:'tenderize-iam',DISCOVERY_JWT_AUDIENCE:'transport-network-discovery'};
const operatorEnv={OPERATOR_JWT_SECRET:operatorSecret,OPERATOR_JWT_ISSUER:'tenderize-iam',OPERATOR_JWT_AUDIENCE:'transport-network-operator'};

const good=jwt({iss:'tenderize-iam',aud:'transport-network-discovery',sub:'mobile-bff',scope:'transport.discovery.read',iat:now-1,exp:now+300},discoverySecret);
assert.equal(verifyDiscoveryToken(good,discoveryEnv,now).ok,true);

const missingScope=jwt({iss:'tenderize-iam',aud:'transport-network-discovery',sub:'mobile-bff',scope:'other.read',iat:now-1,exp:now+300},discoverySecret);
assert.equal(verifyDiscoveryToken(missingScope,discoveryEnv,now).status,403);
assert.equal(verifyDiscoveryToken(good,{},now).status,503);

const operatorToken=jwt({iss:'tenderize-iam',aud:'transport-network-operator',sub:'operator',roles:['admin'],iat:now-1,exp:now+300},operatorSecret);
assert.equal(verifyDiscoveryToken(operatorToken,discoveryEnv,now).ok,false);
assert.equal(verifyOperatorToken(good,operatorEnv,now).ok,false);

console.log('TN7-PUBLISH-1 auth PASS');
