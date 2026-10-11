import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const server=await readFile(new URL('../apps/transport-api/src/server.mjs',import.meta.url),'utf8');
const route=await readFile(new URL('../apps/transport-api/src/mobile-discovery-route.mjs',import.meta.url),'utf8');
const publication=await readFile(new URL('../apps/transport-api/src/mobile-discovery-publication.mjs',import.meta.url),'utf8');
const auth=await readFile(new URL('../apps/transport-api/src/discovery-auth.mjs',import.meta.url),'utf8');
const live=await readFile(new URL('../live/server.mjs',import.meta.url),'utf8');

assert.match(server,/\/api\/v1\/publication\/mobility\/find-taxi/);
assert.doesNotMatch(live,/publication\/mobility\/find-taxi/);
assert.doesNotMatch(route,/access-control-allow-origin/i);
assert.match(auth,/DISCOVERY_JWT_SECRET/);
assert.match(auth,/transport\.discovery\.read/);
assert.doesNotMatch(auth,/OPERATOR_JWT_SECRET/);
assert.match(publication,/route_candidate_promotion/);
assert.match(publication,/taxi_route\.promote/);
assert.match(publication,/merged_into_rank_id IS NULL/);
assert.match(publication,/merged_into_association_id IS NULL/);
for(const forbidden of ['phone','email','address','source_payload','source_record','confidence']){
  assert.equal(publication.includes(forbidden),false,forbidden+' must not be selected by publication');
}

console.log('TN7-PUBLISH-1 static PASS');
