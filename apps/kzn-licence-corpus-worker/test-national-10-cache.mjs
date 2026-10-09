import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  sourceUrlHash,
  artifactObjectKey,
  sourcePointerKey,
  provenanceManifestKey
} from './artifact-cache.mjs';

const url='https://example.org/evidence.pdf';
const checksum=createHash('sha256').update('evidence').digest('hex');

assert.equal(sourceUrlHash(url).length,64);
assert.equal(artifactObjectKey(checksum,'application/pdf'),'artifacts/sha256/'+checksum.slice(0,2)+'/'+checksum+'.pdf');
assert.equal(sourcePointerKey(url),'sources/'+sourceUrlHash(url)+'.json');
const manifest=provenanceManifestKey(url,'2026-10-09T12:00:00.000Z',checksum);
assert.ok(manifest.startsWith('manifests/'+sourceUrlHash(url)+'/'));
assert.ok(manifest.endsWith('-'+checksum+'.json'));

console.log('TN7_NATIONAL_10_CACHE_UNIT_PASS');
