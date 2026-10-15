import fs from 'node:fs';

const manifest=JSON.parse(fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-27-r2-r3-manifest.json','utf8'));
const src=fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-27-r2-r3-resolver.mjs','utf8');
const wf=fs.readFileSync('.github/workflows/tn7-national-27-r2-r3.yml','utf8');

const checks=[
  ['R2-R2 source snapshot locked',manifest.sourceSnapshot.r2r2Head==='df5a7f0bea29ee6400618cfe1e494242edf7425f'],
  ['R2-R2 road window checksum locked',manifest.sourceSnapshot.roadWindowSha256==='45f52271cd3b07a59c476885d2f9dfc3c7290bd66693a0ccb2ecf702f06c0380'],
  ['R2-R2 road feature count locked',manifest.sourceSnapshot.roadFeatureCount===615],
  ['P748 documentary topology constraint present',manifest.documentaryConstraints.P748.requiredTopology.includes('connects_or_approaches_R22')],
  ['L2887 documentary topology constraint present',manifest.documentaryConstraints.L2887.requiredTopology.includes('connects_or_approaches_R22')],
  ['D234 expanded corridor required',manifest.documentaryConstraints.D234.currentWindowExpectedToBeInsufficient===true],
  ['closest geometry cannot create identity',manifest.policy.closestGeometryIsNotIdentity===true],
  ['topology only narrows candidates',manifest.policy.topologyNarrowsCandidatesOnly===true],
  ['exact source snapshot required',manifest.policy.exactSourceSnapshotRequired===true],
  ['resolver enforces official HTTPS source',src.includes("u.protocol!=='https:'")],
  ['resolver rejects redirects',src.includes("redirect:'error'")],
  ['TLS bypass absent',!src.includes('NODE_TLS_REJECT_UNAUTHORIZED')&&!src.includes('rejectUnauthorized:false')&&!src.includes('--insecure')],
  ['base source checksum verified',src.includes('r2r2_source_snapshot_drift')],
  ['R22 retained as control',src.includes('r22_control_geometry_missing')],
  ['P748 topology candidates generated',src.includes("topologyCandidates(base.json.features,r22,'P748')")],
  ['L2887 topology candidates generated',src.includes("topologyCandidates(base.json.features,r22,'L2887')")],
  ['D234 expanded window queried',src.includes('cfg.expandedD234Window')],
  ['literal authoritative identity required for promotion',src.includes("state:'authoritative_attribute_identity_resolved'")],
  ['unique topology candidate still requires documentary confirmation',src.includes('unique_topology_candidate_documentary_confirmation_required')],
  ['automatic road promotion disabled',src.includes('automaticRoadIdentityPromotion:false')],
  ['route candidate creation disabled',src.includes('automaticRouteCandidateCreation:false')],
  ['canonical mutation disabled',src.includes('canonicalMutation:false')],
  ['workflow emits READY state',wf.includes('TN7_NATIONAL_27_R2_R3_RUNTIME_READY')],
  ['workflow emits PARTIAL state',wf.includes('TN7_NATIONAL_27_R2_R3_RUNTIME_PARTIAL')],
  ['workflow uploads evidence',wf.includes('tn7-national-27-r2-r3-evidence')],
  ['R22 control remains documentary bridge',src.includes('r22FeatureCount')]
];

const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log((ok?'PASS ':'FAIL ')+name);
if(failed.length){
  console.error('TN7_NATIONAL_27_R2_R3_STATIC_FAIL '+failed.length+'/'+checks.length);
  process.exit(1);
}
console.log('TN7_NATIONAL_27_R2_R3_STATIC_PASS '+checks.length+'/'+checks.length);
