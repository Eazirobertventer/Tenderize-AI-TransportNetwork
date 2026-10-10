import fs from 'node:fs';

const batch=fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-15-proposal-batch.mjs','utf8');
const schemaApply=fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-15-schema-apply.mjs','utf8');

const checks=[
 ['uses existing controlled creation primitive',batch.includes('createTaxiAssociationCreateProposal')],
 ['requires exactly 9 creation candidates',batch.includes('candidates.length!==9')],
 ['requires exactly 1 hold',batch.includes('holds.length!==1')],
 ['requires placeholder hold reason',batch.includes('association_identity_placeholder')],
 ['uses deterministic idempotency keys',batch.includes("createHash('sha256')") && batch.includes('tn7-national15-')],
 ['schema preflight checks nullable target',batch.includes("is_nullable='YES'")],
 ['schema preflight checks consistency constraint',batch.includes('proposal_target_identity_consistent')],
 ['proposal execution separately gated',batch.includes("NATIONAL15_EXECUTE_PROPOSALS==='true'")],
 ['automatic approval disabled',batch.includes('automaticApproval:false')],
 ['canonical mutation disabled',batch.includes('canonicalMutation:false')],
 ['proposals only policy explicit',batch.includes('proposalsOnly:true')],
 ['requires two person control',batch.includes('twoPersonControlRequired:true')],
 ['verifies target entity id stays null',batch.includes('row.proposal?.targetEntityId===null')],
 ['verifies pending proposal status',batch.includes("row.proposal?.status==='pending'")],
 ['verifies canonical inventory unchanged',batch.includes('canonicalInventoryUnchanged')],
 ['schema apply explicitly gated',schemaApply.includes("NATIONAL15_APPLY_SCHEMA!=='true'")],
 ['schema apply uses reviewed migration 005',schemaApply.includes('005_operator_audit.sql')],
 ['schema apply uses reviewed migration 007',schemaApply.includes('007_two_person_decision_proposals.sql')],
 ['schema apply uses reviewed migration 008',schemaApply.includes('008_transport_entity_aliases.sql')],
 ['schema apply uses reviewed migration 013',schemaApply.includes('013_controlled_association_creation.sql')],
 ['schema apply verifies canonical inventory unchanged',schemaApply.includes('canonicalInventoryUnchanged')]
];

const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log((ok?'PASS ':'FAIL ')+name);
if(failed.length){
 console.error('TN7_NATIONAL_15_STATIC_FAIL '+failed.length+'/'+checks.length);
 process.exit(1);
}
console.log('TN7_NATIONAL_15_STATIC_PASS '+checks.length+'/'+checks.length);
