import fs from 'node:fs';

const evidence=JSON.parse(fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-25-source-acquisition.json','utf8'));
const planner=fs.readFileSync('apps/kzn-licence-corpus-worker/kzn-national-25-source-acquisition.mjs','utf8');
const corpus=fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-8-corpus.mjs','utf8');

const checks=[
 ['two Mbazwana documentary routes banked',evidence.mbazwana.documentaryRoutes.length===2],
 ['Mkhuze route uses D234',evidence.mbazwana.documentaryRoutes.some(x=>x.cleanRouteCode==='22079A2100DX10053141' && x.roadSequence.includes('D234'))],
 ['Manzimbovu route uses P748/R22/L2887',evidence.mbazwana.documentaryRoutes.some(x=>x.cleanRouteCode==='KZPRERC2851126' && ['P748','R22','L2887'].every(r=>x.roadSequence.includes(r)))],
 ['official RoadNetwork2022 banked',evidence.mbazwana.officialRoadNetwork.layerName==='RoadNetwork2022'],
 ['official road network is polyline geometry',evidence.mbazwana.officialRoadNetwork.geometryType==='esriGeometryPolyline'],
 ['route geometry not marked recovered',evidence.mbazwana.documentaryRoutes.every(x=>x.authoritativeRouteGeometryRecovered===false)],
 ['route candidate creation remains blocked',evidence.mbazwana.routeCandidateCreationReady===false],
 ['Gluckstadt coordinate remains unrecovered',evidence.gluckstadt.rankCoordinateRecovered===false],
 ['Gluckstadt rank creation remains blocked',evidence.gluckstadt.rankCreationReady===false],
 ['prose-to-geometry synthesis disabled',evidence.policy.proseToGeometrySynthesis===false],
 ['geometry invention disabled',evidence.policy.geometryInvented===false],
 ['coordinate invention disabled',evidence.policy.coordinatesInvented===false],
 ['planner validates Mbazwana canonical relationship',planner.includes('mbazwanaCanonicalRelationshipReady')],
 ['planner checks Gluckstadt identity collisions',planner.includes('exactIdentityMatches')],
 ['planner never creates route candidates',planner.includes('automaticRouteCandidateCreation:false')],
 ['planner never creates ranks',planner.includes('automaticRankCreation:false')],
 ['canonical mutation disabled',planner.includes('canonicalMutation:false')],
 ['corpus builds NATIONAL-25 plan',corpus.includes('buildNational25SourceAcquisitionPlan(client)')],
 ['NATIONAL-25 endpoint exposed',corpus.includes("url.pathname==='/national25-source-acquisition'")],
 ['corpus transaction remains read only',corpus.includes("BEGIN READ ONLY")]
];

const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log((ok?'PASS ':'FAIL ')+name);
if(failed.length){
  console.error('TN7_NATIONAL_25_STATIC_FAIL '+failed.length+'/'+checks.length);
  process.exit(1);
}
console.log('TN7_NATIONAL_25_STATIC_PASS '+checks.length+'/'+checks.length);
