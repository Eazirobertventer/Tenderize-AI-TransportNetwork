import fs from 'node:fs';

const src=fs.readFileSync('apps/kzn-licence-corpus-worker/tn7-national-27-authoritative-feature-execution.mjs','utf8');

const checks=[
  ['fixed official host enforced',src.includes("const OFFICIAL_HOST='gis.kznpidh.gov.za'")],
  ['https only enforced',src.includes("parsed.protocol!=='https:'")],
  ['redirects rejected',src.includes("redirect:'error'")],
  ['TLS bypass absent',!src.includes('NODE_TLS_REJECT_UNAUTHORIZED') && !src.includes('rejectUnauthorized:false')],
  ['response size bounded',src.includes('MAX_BYTES=8*1024*1024')],
  ['responses checksummed',src.includes('sha256')],
  ['Taxi_Ranks query bounded to GLUCK',src.includes("RANK_CODE LIKE '%GLUCK%'")],
  ['four required roads looped',src.includes('cfg.mbazwana.requiredRoads')],
  ['RoadNetwork queried by ROADNUM',src.includes("where:\"ROADNUM='\"+roadNumber+\"'\"")],
  ['out SR 4326 requested',src.includes("base.searchParams.set('outSR','4326')")],
  ['GeoJSON required',src.includes("json.type!=='FeatureCollection'")],
  ['Gluckstadt exact point requires uniqueness',src.includes('pointCandidates.length===1')],
  ['rank creation remains disabled',src.includes('automaticRankCreation:false')],
  ['route candidate creation remains disabled',src.includes('automaticRouteCandidateCreation:false')],
  ['canonical mutation remains disabled',src.includes('canonicalMutation:false')],
  ['P748/R22 topology measured',src.includes('p748ToR22MinVertexDistanceMetres')],
  ['R22/L2887 topology measured',src.includes('r22ToL2887MinVertexDistanceMetres')],
  ['topology threshold bounded',src.includes('<=150')],
  ['prose-to-geometry remains disabled',src.includes('proseToGeometrySynthesis:false')],
  ['coordinate invention remains disabled',src.includes('coordinatesInvented:false')],
  ['geometry invention remains disabled',src.includes('geometryInvented:false')],
  ['blocked source execution fails closed',src.includes('TN7_NATIONAL_27_SOURCE_EXECUTION_BLOCKED')],
  ['success marker present',src.includes('TN7_NATIONAL_27_AUTHORITATIVE_FEATURE_EXECUTION_PASS')]
];

const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log((ok?'PASS ':'FAIL ')+name);
if(failed.length){
  console.error('TN7_NATIONAL_27_STATIC_FAIL '+failed.length+'/'+checks.length);
  process.exit(1);
}
console.log('TN7_NATIONAL_27_STATIC_PASS '+checks.length+'/'+checks.length);
