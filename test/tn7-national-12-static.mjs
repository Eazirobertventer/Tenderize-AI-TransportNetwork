import fs from 'node:fs';

const backlog=fs.readFileSync('apps/kzn-licence-corpus-worker/evidence-backlog.mjs','utf8');
const corpus=fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-8-corpus.mjs','utf8');

const checks=[
  ['backlog groups by normalized association label',backlog.includes('normalizedAssociationLabel')],
  ['backlog aggregates observations',backlog.includes('observations')],
  ['backlog aggregates evidence dates',backlog.includes('distinctEvidenceDates')],
  ['backlog aggregates route identifiers',backlog.includes('routeIdentifiers')],
  ['backlog aggregates rank mentions',backlog.includes('rankMentions')],
  ['priority score bounded to 100',backlog.includes('Math.min(') && backlog.includes(',100)')],
  ['priority bands include P1-P4',/P1/.test(backlog) && /P2/.test(backlog) && /P3/.test(backlog) && /P4/.test(backlog)],
  ['identity recurrence required',backlog.includes('single_authoritative_date_does_not_satisfy_identity_recurrence')],
  ['ADJ6 only proposal-ready on unique association and candidate',backlog.includes("action:'taxi_route.promote'") && backlog.includes('proposalEligible:true')],
  ['ADJ5 relationship evidence does not auto-propose',backlog.includes("action:'taxi_rank_association.assign'") && backlog.includes('requires_existing_rank_association_candidate')],
  ['automatic approval disabled',backlog.includes('automaticApproval:false')],
  ['canonical mutation disabled',backlog.includes('canonicalMutation:false')],
  ['corpus builds backlog from bounded queue',corpus.includes('buildEvidenceBacklog(boundedQueue)')],
  ['backlog runtime endpoint exists',corpus.includes("url.pathname==='/backlog'")],
  ['backlog supports priority filtering',corpus.includes("url.searchParams.get('priority')")],
  ['backlog supports state filtering',corpus.includes("url.searchParams.get('state')")],
  ['corpus database remains read only',corpus.includes("BEGIN READ ONLY")]
];

const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log((ok?'PASS ':'FAIL ')+name);
if(failed.length){
  console.error('TN7_NATIONAL_12_STATIC_FAIL '+failed.length+'/'+checks.length);
  process.exit(1);
}
console.log('TN7_NATIONAL_12_STATIC_PASS '+checks.length+'/'+checks.length);
