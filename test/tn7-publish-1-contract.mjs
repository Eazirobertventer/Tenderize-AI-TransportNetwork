import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateTransportDiscoveryDocument } from '../apps/transport-api/src/mobile-discovery-contract.mjs';

const fixture=JSON.parse(await readFile(new URL('../apps/transport-api/test/fixtures/fairpay-transport-discovery.golden.json',import.meta.url),'utf8'));
assert.equal(validateTransportDiscoveryDocument(fixture).ok,true);

for(const mutate of [
  value=>{value.extra='no';},
  value=>{value.routes[0].fare=50;},
  value=>{value.routes[0].taxis=[];},
  value=>{value.routes[0].originRank.rankId=' ';},
  value=>{value.routes[0].destinationRank.rankId=value.routes[0].originRank.rankId;},
  value=>{value.routes[0].originRank.coordinate.latitude=95;},
  value=>{value.routes[0].associations.push({...value.routes[0].associations[0]});}
]){
  const copy=structuredClone(fixture);
  mutate(copy);
  assert.equal(validateTransportDiscoveryDocument(copy).ok,false);
}

console.log('TN7-PUBLISH-1 contract PASS');
