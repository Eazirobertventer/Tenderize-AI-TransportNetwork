import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseGazetteText } from './parser.mjs';

const text=await readFile(new URL('./test-fixture.txt',import.meta.url),'utf8');
const result=parseGazetteText(text,{
  documentId:'LGKZNG11-2025-JUN',
  date:'2025-06',
  url:'fixture://tn6-z1',
  authority:'KwaZulu-Natal Department of Transport'
});

assert.equal(result.rows.length,2);
assert.equal(result.rows[0].applicationNumber,'APP0198211');
assert.equal(result.rows[0].associationLabel,'BERGVILLE TAXI ASSOCIATION');
assert.equal(result.rows[0].operatingLicenceNumber,'LGKZN0303009999');
assert.ok(result.rows[0].routeIdentifiers.includes('22068A22068A00051961'));
assert.ok(result.rows[0].rankMentions.some(x=>/BERGVILLE TAXI RANK/i.test(x)));
assert.equal(result.rows[1].associationLabel,'ESTCOURT DISTRICT TAXI ASSOCIATION');
assert.ok(result.rows[1].normalizedRankMentions.some(x=>x.includes('estcourt taxi rank')));
assert.equal(result.rows[0].rankLinkWrites,false);
assert.equal(result.rows[0].routeCandidateWrites,false);

console.log(JSON.stringify({event:'tn6_z1_parser_test_pass',rows:result.rows.length}));
