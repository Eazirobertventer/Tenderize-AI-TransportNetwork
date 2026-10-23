import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  evidenceCacheEnabled,
  storeEvidenceArtifact,
  loadCachedEvidenceArtifact
} from './artifact-cache.mjs';

assert.equal(evidenceCacheEnabled(),true,'evidence cache must be enabled');

const sourceUrl='https://evidence.tenderize.local/tn7-national-10/cache-proof-v1';
const buffer=Buffer.from('TN7-NATIONAL-10-CACHE-PROOF-v1');
const checksum=createHash('sha256').update(buffer).digest('hex');

const first=await storeEvidenceArtifact({
  buffer,
  sourceUrl,
  checksum,
  contentType:'application/octet-stream',
  bytes:buffer.length,
  authority:'Tenderize TN7 runtime acceptance',
  sourceAdapter:'tn7-national-10-cache-proof',
  documentId:'TN7-NATIONAL-10-CACHE-PROOF'
});

assert.equal(first.enabled,true);
assert.ok(first.artifactKey.includes(checksum));

const loaded=await loadCachedEvidenceArtifact(sourceUrl);
assert.equal(loaded.hit,true);
assert.equal(loaded.checksum,checksum);
assert.equal(loaded.buffer.toString('utf8'),buffer.toString('utf8'));

const second=await storeEvidenceArtifact({
  buffer,
  sourceUrl,
  checksum,
  contentType:'application/octet-stream',
  bytes:buffer.length,
  authority:'Tenderize TN7 runtime acceptance',
  sourceAdapter:'tn7-national-10-cache-proof',
  documentId:'TN7-NATIONAL-10-CACHE-PROOF'
});

assert.equal(second.reused,true);
assert.equal(second.artifactKey,first.artifactKey);

console.log(JSON.stringify({
  event:'TN7_NATIONAL_10_CACHE_RUNTIME_PASS',
  checksum,
  artifactKey:first.artifactKey,
  pointerKey:first.pointerKey,
  immutableReuse:second.reused,
  bytes:buffer.length
}));
