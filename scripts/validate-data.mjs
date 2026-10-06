import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const seed = JSON.parse(await readFile(resolve(root, 'prototype/data/seed-network.json'), 'utf8'));
const errors = [];
const ids = new Set();

for (const rank of seed.ranks) {
  if (!rank.id || ids.has(rank.id)) errors.push(`duplicate/missing rank id: ${rank.id}`);
  ids.add(rank.id);
  if (!rank.name) errors.push(`${rank.id}: missing name`);
  if (!Number.isFinite(rank.lat) || !Number.isFinite(rank.lng)) errors.push(`${rank.id}: invalid coordinates`);
  if (rank.lat > -20 || rank.lat < -36 || rank.lng < 15 || rank.lng > 34) errors.push(`${rank.id}: coordinates outside expected South Africa bounds`);
  if (!['official','verified','documented','community_verified','candidate','inferred','conflict','unverified'].includes(rank.status)) errors.push(`${rank.id}: invalid status ${rank.status}`);
}
for (const route of seed.routes) {
  if (!route.id || ids.has(route.id)) errors.push(`duplicate/missing route id: ${route.id}`);
  ids.add(route.id);
  if (route.status === 'official' && route.geometryStatus !== 'official_geometry') errors.push(`${route.id}: official route cannot claim official status without official geometry in seed`);
  if (route.prototypeOnly && route.status !== 'inferred') errors.push(`${route.id}: prototype-only route must be inferred`);
}

if (errors.length) {
  console.error(`Data validation failed (${errors.length})`);
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`PASS: ${seed.ranks.length} ranks, ${seed.associations.length} associations, ${seed.routes.length} routes validated.`);
