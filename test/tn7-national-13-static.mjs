import fs from 'node:fs';

const manifest=JSON.parse(fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-8-sources.json','utf8'));
const backlog=fs.readFileSync('apps/kzn-licence-corpus-worker/evidence-backlog.mjs','utf8');

const datedSeeds=manifest.adapters.filter(x=>
  ['uthukela-kzn-provincial-gazette-2605','lawlibrary-kzn-provincial-gazette-2780'].includes(x.id)
);

const dates=datedSeeds.flatMap(x=>(x.documents||[]).map(d=>d.date)).filter(Boolean);

const checks=[
  ['two dated recurrence adapters configured',datedSeeds.length===2],
  ['two distinct authoritative dates configured',new Set(dates).size===2],
  ['2023 recurrence seed retained',dates.includes('2023-10-12')],
  ['2025 recurrence seed added',dates.includes('2025-02-13')],
  ['both seeds preserve GPW/KZN authority',datedSeeds.every(x=>x.authority==='KwaZulu-Natal Provincial Gazette / Government Printing Works')],
  ['both seeds record retrieval mirrors',datedSeeds.every(x=>Boolean(x.retrievalMirror))],
  ['backlog identity recurrence requires two dates',backlog.includes('group.distinctEvidenceDates.length>=2')],
  ['single date remains blocked',backlog.includes('single_authoritative_date_does_not_satisfy_identity_recurrence')],
  ['recurrence moves to controlled identity review',backlog.includes("state:'controlled_association_identity_review'")],
  ['no automatic identity proposal',backlog.includes('proposalEligible:false')],
  ['automatic canonical mutation disabled',backlog.includes('canonicalMutation:false')]
];

const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log((ok?'PASS ':'FAIL ')+name);
if(failed.length){
  console.error('TN7_NATIONAL_13_STATIC_FAIL '+failed.length+'/'+checks.length);
  process.exit(1);
}
console.log('TN7_NATIONAL_13_STATIC_PASS '+checks.length+'/'+checks.length);
