import fs from 'node:fs';

const runner=fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-23-mbazwana-adj5.mjs','utf8');

const checks=[
 ['targets exact Mbazwana rank',runner.includes("RANK_ID='acadacb7-ae3b-4581-a28b-ba445af280ba'")],
 ['targets exact Mbazwana association',runner.includes("ASSOCIATION_ID='1561a588-e225-4af3-b5ca-12ba5e754f4a'")],
 ['uses two-date recurrence',runner.includes("FIRST_SEEN='2023-10-12") && runner.includes("LAST_SEEN='2025-02-13")],
 ['candidate materialisation separately gated',runner.includes("NATIONAL23_MATERIALIZE_CANDIDATE==='true'")],
 ['ADJ5 proposal separately gated',runner.includes("NATIONAL23_CREATE_ADJ5_PROPOSAL==='true'")],
 ['candidate materialisation audited',runner.includes("action:'rank_association_candidate.materialize'")],
 ['candidate materialisation transactional',runner.includes("await client.query('BEGIN')") && runner.includes("await client.query('COMMIT')")],
 ['reuses ADJ5 snapshot builder',runner.includes('buildRankAssociationSnapshot')],
 ['reuses ADJ5 validator',runner.includes('validateRankAssociationSnapshot')],
 ['proposal uses controlled ADJ5 primitive',runner.includes('createRankAssociationAssignmentProposal')],
 ['stable proposal idempotency key',runner.includes('tn7-national23-mbazwana-adj5-proposal')],
 ['proposal carries both gazette sources',runner.includes('KZN-PROVINCIAL-GAZETTE-2605-2023-10-12') && runner.includes('KZN-PROVINCIAL-GAZETTE-2780-2025-02-13')],
 ['proposal carries alias audit chain',runner.includes('b311f3a5-a22f-4564-bf52-66922e4884ab') && runner.includes('1999ca79-6f12-4fdc-a9d5-5a690b29cdf9')],
 ['automatic approval disabled',runner.includes('automaticApproval:false')],
 ['relationship mutation disabled',runner.includes('relationshipMutation:false')],
 ['requires proposal state proposed',runner.includes("p?.status==='proposed'")],
 ['non-target canonical counts checked',runner.includes('result.before.ranks===result.after.ranks') && runner.includes('result.before.routes===result.after.routes')]
];

const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log((ok?'PASS ':'FAIL ')+name);
if(failed.length){
  console.error('TN7_NATIONAL_23_STATIC_FAIL '+failed.length+'/'+checks.length);
  process.exit(1);
}
console.log('TN7_NATIONAL_23_STATIC_PASS '+checks.length+'/'+checks.length);
