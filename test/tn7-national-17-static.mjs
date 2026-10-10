import fs from 'node:fs';

const batch=fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-17-approval-batch.mjs','utf8');
const proposals=fs.readFileSync('apps/transport-api/src/operator-proposals.mjs','utf8');
const create=fs.readFileSync('apps/transport-api/src/operator-association-create.mjs','utf8');
const associationApproval=proposals.slice(proposals.indexOf('if(isTaxiAssociationCreateProposal)'));

const checks=[
 ['targets exactly nine proposals',batch.includes("proposals.length!==9")],
 ['requires independent approver subject',batch.includes('independent_approver_subject_required')],
 ['requires approver role',batch.includes('independent_approver_role_required')],
 ['forbids self approval',batch.includes('national17_self_approval_forbidden')],
 ['uses stable decision idempotency keys',batch.includes('tn7-national17-approve-')],
 ['loads cached evidence checksums',batch.includes('loadCachedEvidenceArtifact')],
 ['requires 64-char sha256',batch.includes('/^[0-9a-f]{64}$/')],
 ['approval evidence includes source lineage',batch.includes('sourceLineage')],
 ['approval path validates source lineage before insert',associationApproval.indexOf('validateAssociationCreationSourceLineage')>=0 && associationApproval.indexOf('validateAssociationCreationSourceLineage')<associationApproval.indexOf('insertCanonicalAssociation')],
 ['approval path writes source records',proposals.includes('insertAssociationCreationSourceRecords')],
 ['source records are returned in mutation result',proposals.includes('sourceRecordIds')],
 ['association source records use taxi_association entity type',create.includes("'taxi_association'")],
 ['first-run acceptance requires 18 source records',batch.includes('sourceRecordsCreated===18')],
 ['replay acceptance requires nine replays',batch.includes('result.summary.replayed===9')]
];

const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log((ok?'PASS ':'FAIL ')+name);
if(failed.length){
  console.error('TN7_NATIONAL_17_STATIC_FAIL '+failed.length+'/'+checks.length);
  process.exit(1);
}
console.log('TN7_NATIONAL_17_STATIC_PASS '+checks.length+'/'+checks.length);
