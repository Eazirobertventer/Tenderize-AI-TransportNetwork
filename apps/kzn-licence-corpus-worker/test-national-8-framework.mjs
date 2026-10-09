import assert from 'node:assert/strict';
import {
  discoverDocumentLinks,
  dedupeDocuments,
  normalizeEvidenceRows,
  normalizeEvidenceText,
  classifyEvidenceRow
} from './evidence-execution-framework.mjs';

const html=`
<html><body>
<a href="1.pdf">one</a>
<a href="/za/gaz/ZAKZPrGaz/2026/2.pdf">two</a>
<a href="2.pdf">two duplicate</a>
<a href="notes.html">ignore</a>
</body></html>`;

const links=discoverDocumentLinks(html,'https://www.saflii.org/za/gaz/ZAKZPrGaz/2026/',{
  includePatterns:['/ZAKZPrGaz/2026/[^/]+\\\\.pdf$']
});
assert.equal(links.length,2);
assert.ok(links.every(x=>x.endsWith('.pdf')));

const deduped=dedupeDocuments([
  {documents:[{url:'https://www.saflii.org/a.pdf',id:'a'}]},
  {documents:[{url:'https://www.saflii.org/a.pdf',id:'b'},{url:'https://www.saflii.org/b.pdf',id:'c'}]}
],{maxDocuments:10});
assert.equal(deduped.length,2);

assert.equal(normalizeEvidenceText('  BHAMSHELA-&-APPELSBOSCH  '),'bhamshela and appelsbosch');

const rows=normalizeEvidenceRows([{
  applicationNumber:'APP1',
  associationLabel:'Example Taxi Association',
  routeIdentifiers:['R001'],
  rankMentions:['Example Rank'],
  extractionConfidence:0.9
}],{
  document:{adapterId:'test',url:'https://example.org/a.pdf',province:'KwaZulu-Natal',authority:'Test',sourceClass:'provincial_transport',documentId:'doc1'},
  checksum:'abc'
});
assert.equal(rows.length,1);
assert.equal(rows[0].province,'KwaZulu-Natal');
assert.equal(rows[0].sourceChecksum,'abc');
assert.equal(rows[0].evidenceId.length,64);

assert.equal(classifyEvidenceRow(rows[0],{associationMatches:[],routeCandidateMatches:[],rankMatches:[]}).bucket,'association_identity_pending');
assert.equal(classifyEvidenceRow(rows[0],{associationMatches:[{id:'a'}],routeCandidateMatches:[{id:'r',association_id:null}],rankMatches:[]}).bucket,'route_candidate_evidence_ready');

console.log('TN7_NATIONAL_8_FRAMEWORK_UNIT_PASS');
