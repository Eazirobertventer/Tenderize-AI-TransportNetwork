import fs from 'node:fs';

const evidence=JSON.parse(fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-26-control-point-road-acquisition.json','utf8'));
const planner=fs.readFileSync('apps/kzn-licence-corpus-worker/kzn-national-26-control-point-road-acquisition.mjs','utf8');
const corpus=fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-8-corpus.mjs','utf8');

const checks=[
  ['Gluckstadt control area evidence banked',evidence.gluckstadt.controlAreaRecovered===true],
  ['Gluckstadt exact point remains pending',evidence.gluckstadt.controlPointRecovered===false],
  ['official Taxi_Ranks layer identified',evidence.gluckstadt.officialFeatureService.layerName==='Taxi_Ranks'],
  ['Taxi_Ranks layer is point geometry',evidence.gluckstadt.officialFeatureService.geometryType==='esriGeometryPoint'],
  ['Gluckstadt rank creation remains blocked',evidence.gluckstadt.rankCreationReady===false],
  ['four Mbazwana road numbers required',evidence.mbazwana.requiredRoads.length===4],
  ['required roads are D234/P748/R22/L2887',['D234','P748','R22','L2887'].every(x=>evidence.mbazwana.requiredRoads.includes(x))],
  ['official RoadNetwork2022 layer identified',evidence.mbazwana.alternateAcquisition.layerName==='RoadNetwork2022'],
  ['RoadNetwork2022 is polyline geometry',evidence.mbazwana.alternateAcquisition.geometryType==='esriGeometryPolyline'],
  ['feature query supports geoJSON',evidence.mbazwana.alternateAcquisition.supportedQueryFormats.includes('geoJSON')],
  ['route geometry remains unrecovered',evidence.mbazwana.routeGeometryRecovered===false],
  ['route candidate creation remains blocked',evidence.mbazwana.routeCandidateCreationReady===false],
  ['map-image coordinate extraction disabled',evidence.policy.mapImageCoordinateExtraction===false],
  ['prose-to-geometry synthesis disabled',evidence.policy.proseToGeometrySynthesis===false],
  ['geometry invention disabled',evidence.policy.geometryInvented===false],
  ['coordinate invention disabled',evidence.policy.coordinatesInvented===false],
  ['planner checks Gluckstadt identity collisions',planner.includes('exactIdentityMatches')],
  ['planner validates Mbazwana relationship',planner.includes('mbazwanaCanonicalRelationshipReady')],
  ['planner is declarative external acquisition only',planner.includes('acquisitionRequestsDeclarativeOnly:true')],
  ['planner never creates route candidates',planner.includes('automaticRouteCandidateCreation:false')],
  ['planner never creates ranks',planner.includes('automaticRankCreation:false')],
  ['canonical mutation disabled',planner.includes('canonicalMutation:false')],
  ['corpus builds NATIONAL-26 plan',corpus.includes('buildNational26AcquisitionPlan(client)')],
  ['NATIONAL-26 endpoint exposed',corpus.includes("url.pathname==='/national26-acquisition-plan'")],
  ['corpus transaction remains read only',corpus.includes("BEGIN READ ONLY")]
];

const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log((ok?'PASS ':'FAIL ')+name);
if(failed.length){
  console.error('TN7_NATIONAL_26_STATIC_FAIL '+failed.length+'/'+checks.length);
  process.exit(1);
}
console.log('TN7_NATIONAL_26_STATIC_PASS '+checks.length+'/'+checks.length);
