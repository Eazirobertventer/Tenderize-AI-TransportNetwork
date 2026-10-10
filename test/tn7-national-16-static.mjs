import fs from 'node:fs';

const review=fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-16-review.mjs','utf8');

const checks=[
 ['review-only transaction expected',review.includes("BEGIN READ ONLY")],
 ['targets NATIONAL-15 proposal batch',review.includes("proposer_subject='tn7-national15-controlled-batch'")],
 ['rebuilds association creation snapshot',review.includes('buildAssociationCreationSnapshot')],
 ['revalidates snapshot',review.includes('validateAssociationCreationSnapshot')],
 ['rechecks before-state hash',review.includes('beforeStateFresh')],
 ['requires two authoritative dates',review.includes('authoritativeRecurrence')],
 ['requires independent approver',review.includes('independentApproverRequired:true')],
 ['self approval remains forbidden',review.includes('selfApprovalForbidden:true')],
 ['checks source registry mapping',review.includes('sourceRegistryMapped')],
 ['requires source lineage payload',review.includes('sourceLineagePayloadReady')],
 ['blocks missing approval source writer',review.includes('approval_path_source_record_writer_missing')],
 ['does not approve',review.includes('noApproval:true')],
 ['does not mutate canonical state',review.includes('noCanonicalMutation:true')],
 ['verifies inventory unchanged',review.includes('canonicalInventory')]
];

const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log((ok?'PASS ':'FAIL ')+name);
if(failed.length){
  console.error('TN7_NATIONAL_16_STATIC_FAIL '+failed.length+'/'+checks.length);
  process.exit(1);
}
console.log('TN7_NATIONAL_16_STATIC_PASS '+checks.length+'/'+checks.length);
