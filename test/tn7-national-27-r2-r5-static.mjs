import fs from 'node:fs';

const manifest=JSON.parse(fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-27-r2-r5-alias-recovery.json','utf8'));
const src=fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-27-r2-r5-alias-recovery.mjs','utf8');
const wf=fs.readFileSync('.github/workflows/tn7-national-27-r2-r5.yml','utf8');

const checks=[
  ['R4 source head locked',manifest.sourceGate.head==='b8d193a17b2f1f966209e76100e4510e775c9ea8'],
  ['P748 historical evidence banked',manifest.historicalCrosswalkEvidence.P748.length>=2],
  ['A1108 distinct-road evidence banked',manifest.historicalCrosswalkEvidence.A1108.length>=2],
  ['L2887 municipal and EPWP evidence banked',manifest.historicalCrosswalkEvidence.L2887.length>=2],
  ['D234 recurrent gazette evidence banked',manifest.historicalCrosswalkEvidence.D234.length>=2],
  ['A1108 hard excluded from P748 aliasing',manifest.documentaryElimination.P748.excludeAliases.includes('A1108')],
  ['A1108 hard excluded from L2887 aliasing',manifest.documentaryElimination.L2887.excludeAliases.includes('A1108')],
  ['historical alias must be explicit',manifest.policy.historicalAliasMustBeExplicit===true],
  ['same locality cannot create alias',manifest.policy.sameLocalityDoesNotCreateAlias===true],
  ['same topology cannot create alias',manifest.policy.sameTopologyDoesNotCreateAlias===true],
  ['resolver uses official HTTPS source',src.includes("u.protocol!=='https:'")],
  ['resolver rejects redirects',src.includes("redirect:'error'")],
  ['TLS bypass absent',!src.includes('NODE_TLS_REJECT_UNAUTHORIZED')&&!src.includes('rejectUnauthorized:false')&&!src.includes('--insecure')],
  ['remaining L2887 candidates revalidated',src.includes('r4_candidate_feature_missing')],
  ['province-wide exact-code probes present',src.includes("for(const road of ['P748','L2887'])")],
  ['D234 geometry probe present',src.includes("exactCodeWhere('D234')")],
  ['D234 unrelated corridor rejection present',src.includes('outsideUmkhanyakudeFeatureCount')],
  ['current GIS probe cannot invent historical alias',src.includes('currentGisExactCodeProbeDoesNotCreateHistoricalAlias:true')],
  ['automatic road promotion disabled',src.includes('automaticRoadIdentityPromotion:false')],
  ['route candidate creation disabled',src.includes('automaticRouteCandidateCreation:false')],
  ['canonical mutation disabled',src.includes('canonicalMutation:false')],
  ['workflow emits READY',wf.includes('TN7_NATIONAL_27_R2_R5_RUNTIME_READY')],
  ['workflow emits HOLD',wf.includes('TN7_NATIONAL_27_R2_R5_RUNTIME_HOLD')],
  ['workflow uploads evidence',wf.includes('tn7-national-27-r2-r5-evidence')],
  ['R5 keeps P748 unresolved without explicit alias',src.includes("historical_alias_register_still_required")]
];

const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log((ok?'PASS ':'FAIL ')+name);
if(failed.length){
  console.error('TN7_NATIONAL_27_R2_R5_STATIC_FAIL '+failed.length+'/'+checks.length);
  process.exit(1);
}
console.log('TN7_NATIONAL_27_R2_R5_STATIC_PASS '+checks.length+'/'+checks.length);
