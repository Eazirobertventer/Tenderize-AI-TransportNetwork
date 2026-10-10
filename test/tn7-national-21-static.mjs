import fs from 'node:fs';

const runner=fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-21-alias-proposal.mjs','utf8');
const evidence=JSON.parse(fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-21-evidence.json','utf8'));

const checks=[
 ['Mbazwana targets KRPUMD002',evidence.mbazwana.targetCanonicalName==='KRPUMD002' && evidence.mbazwana.targetRankId==='acadacb7-ae3b-4581-a28b-ba445af280ba'],
 ['Mbazwana alias is exact',evidence.mbazwana.proposedAlias==='Mbazwana Taxi Rank'],
 ['official KZN rank point retained',evidence.mbazwana.officialRankSource?.sourceKey==='kzn-taxi-ranks-degraded-tls'],
 ['municipal evidence retained',evidence.mbazwana.municipalEvidence?.authority==='uMhlabuyalingana Local Municipality'],
 ['Gluckstadt remains location pending',evidence.gluckstadt.status==='location_pending' && evidence.gluckstadt.rankCoordinateRecovered===false],
 ['route geometry still not recovered',evidence.routeGeometrySourceExpansion.authoritativeGeometryRecovered===false],
 ['no route geometry invented',evidence.routeGeometrySourceExpansion.geometryInvented===false],
 ['runner uses controlled alias proposal primitive',runner.includes('createAliasProposal')],
 ['runner targets taxi_rank alias action',runner.includes("entityType:'taxi_rank'")],
 ['proposal execution separately gated',runner.includes("NATIONAL21_EXECUTE_ALIAS_PROPOSAL==='true'")],
 ['stable idempotency key used',runner.includes('tn7-national21-mbazwana-rank-alias')],
 ['proposal only policy explicit',runner.includes('proposalOnly:true')],
 ['automatic approval disabled',runner.includes('automaticApproval:false')],
 ['canonical mutation disabled',runner.includes('canonicalMutation:false')],
 ['two person control required',runner.includes('twoPersonControlRequired:true')],
 ['requires proposal status proposed',runner.includes("p?.status==='proposed'")],
 ['verifies canonical inventory unchanged',runner.includes('canonicalInventoryUnchanged')]
];

const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log((ok?'PASS ':'FAIL ')+name);
if(failed.length){
  console.error('TN7_NATIONAL_21_STATIC_FAIL '+failed.length+'/'+checks.length);
  process.exit(1);
}
console.log('TN7_NATIONAL_21_STATIC_PASS '+checks.length+'/'+checks.length);
