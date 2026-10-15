import { createHmac } from 'node:crypto';

const api=(process.env.API_BASE||'').replace(/\/$/,'');
const web=(process.env.WEB_BASE||'').replace(/\/$/,'');
const workbench=(process.env.WORKBENCH_BASE||'').replace(/\/$/,'');
const secret=process.env.OPERATOR_JWT_SECRET||'';
const issuer=process.env.OPERATOR_JWT_ISSUER||'tenderize-iam';
const audience=process.env.OPERATOR_JWT_AUDIENCE||'transport-network-operator';
if(!api || !web || !workbench || secret.length<32) throw new Error('runtime_configuration_missing');

function b64(v){return Buffer.from(v).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');}
function token(sub,roles){
  const now=Math.floor(Date.now()/1000);
  const h=b64(JSON.stringify({alg:'HS256',typ:'JWT'}));
  const p=b64(JSON.stringify({iss:issuer,aud:audience,sub,roles,iat:now-5,exp:now+900,name:sub}));
  const s=createHmac('sha256',secret).update(h+'.'+p).digest('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  return h+'.'+p+'.'+s;
}
async function json(base,path,{method='GET',bearer=null}={}){
  const headers={};
  if(bearer) headers.authorization='Bearer '+bearer;
  const r=await fetch(base+path,{method,headers,cache:'no-store'});
  const text=await r.text();let payload;try{payload=text?JSON.parse(text):null}catch{payload=text}
  return {status:r.status,payload,text};
}
function assert(ok,label){if(!ok) throw new Error('FAIL '+label);console.log('PASS '+label);}

const before=await json(api,'/api/v1/network-inventory');
assert(before.status===200,'preview inventory before NATIONAL-1 proof available');

const national=await json(api,'/api/v1/coverage/national');
assert(national.status===200 && national.payload?.mode==='coverage_gap_model','national coverage gap model available');
assert(national.payload?.canonicalMutationEnabled===false,'coverage model is explicitly non-mutating');
assert((national.payload?.provinces||[]).length===9,'all nine provinces returned');
const provinceNames=new Set((national.payload.provinces||[]).map(p=>p.province));
for(const name of ['Gauteng','KwaZulu-Natal','Western Cape','Eastern Cape','Free State','Limpopo','Mpumalanga','North West','Northern Cape']){
  assert(provinceNames.has(name),'province present '+name);
}
const scores=(national.payload.provinces||[]).map(p=>Number(p.priorityScore||0));
assert(scores.every((v,i)=>i===0 || scores[i-1]>=v),'province backlog sorted by operational priority');
assert((national.payload.provinces||[]).every(p=>['critical','high','medium','low','complete'].includes(p.priorityBand)),'province priority bands valid');
assert(typeof national.payload.priorityDisclaimer==='string' && national.payload.priorityDisclaimer.includes('not canonical confidence'),'priority semantics explicitly non-canonical');

assert(Number(national.payload.national?.ranks)===Number(before.payload.ranks),'national rank total reconciles to inventory');
assert(Number(national.payload.national?.mapped_ranks)===Number(before.payload.mapped_ranks),'national mapped-rank total reconciles to inventory');
assert(Number(national.payload.national?.associations)===Number(before.payload.associations),'national association total reconciles to inventory');
assert(Number(national.payload.national?.routes)===Number(before.payload.routes),'national route total reconciles to inventory');
assert(Number(national.payload.national?.location_pending_ranks)>=0,'location-pending national gap measured');
assert(Number(national.payload.national?.ranks_without_association)>=0,'rank-association national gap measured');
assert(Number(national.payload.national?.routes_with_unresolved_endpoints)>=0,'route endpoint national gap measured');
assert(national.payload.unscoped && Number.isFinite(Number(national.payload.unscoped.routeGap)),'unscoped national residual exposed');

const province=(national.payload.provinces||[]).find(p=>Number(p.ranks)>0)?.province;
assert(Boolean(province),'at least one populated province available for drill-down');
const drill=await json(api,'/api/v1/coverage/national?province='+encodeURIComponent(province));
assert(drill.status===200 && Array.isArray(drill.payload.municipalities),'municipality drill-down response available');
assert(drill.payload.municipalities.length>0,'municipality drill-down contains populated areas');
assert(drill.payload.municipalities.every(m=>m.province===province),'municipality drill-down remains province scoped');

const gaps=await json(api,'/api/v1/coverage/gaps?province='+encodeURIComponent(province));
assert(gaps.status===200 && gaps.payload?.type==='FeatureCollection','coverage gap GeoJSON available');
assert((gaps.payload.features||[]).every(f=>Array.isArray(f.properties?.gapClasses) && f.properties.gapClasses.length>0),'every gap map point carries explicit gap class');
assert((gaps.payload.features||[]).every(f=>Array.isArray(f.geometry?.coordinates) && f.geometry.coordinates.every(Number.isFinite)),'gap map features have valid coordinates');

const publicNational=await json(web,'/api/v1/coverage/national');
assert(publicNational.status===200 && (publicNational.payload.provinces||[]).length===9,'public read-only Web proxies national coverage model');
const publicGaps=await json(web,'/api/v1/coverage/gaps?province='+encodeURIComponent(province));
assert(publicGaps.status===200 && publicGaps.payload?.type==='FeatureCollection','public read-only Web proxies coverage gaps');
const blockedPost=await json(web,'/api/v1/coverage/national',{method:'POST'});
assert(blockedPost.status===405,'public Web keeps coverage resources read-only');

const webHome=await fetch(web+'/',{cache:'no-store'});
const webHtml=await webHome.text();
assert(webHome.status===200 && webHtml.includes('coverageGapToggle'),'operational map exposes coverage gap toggle');

const reviewer=token('national1-reviewer',['reviewer']);
const operatorCoverage=await json(workbench,'/operator-api/api/v1/operator/workbench?limit=30',{bearer:reviewer});
assert(operatorCoverage.status===200 && operatorCoverage.payload?.coverage?.mode==='coverage_gap_model','private operator workbench embeds coverage model');
assert((operatorCoverage.payload.coverage.provinces||[]).length===9,'operator workbench coverage includes all nine provinces');
assert(operatorCoverage.payload.coverage.canonicalMutationEnabled===false,'operator coverage model remains non-mutating');

const after=await json(api,'/api/v1/network-inventory');
assert(after.status===200,'preview inventory after NATIONAL-1 proof available');
for(const key of ['ranks','mapped_ranks','location_pending_ranks','associations','routes','rank_association_candidates']){
  assert(Number(before.payload[key])===Number(after.payload[key]),'canonical inventory unchanged '+key);
}

console.log('TN7_NATIONAL_1_COUNTS '+JSON.stringify({
  ranks:after.payload.ranks,
  mappedRanks:after.payload.mapped_ranks,
  locationPendingRanks:after.payload.location_pending_ranks,
  associations:after.payload.associations,
  routes:after.payload.routes,
  rankAssociationCandidates:after.payload.rank_association_candidates,
  ranksWithoutAssociation:national.payload.national.ranks_without_association,
  routeEndpointGaps:national.payload.national.routes_with_unresolved_endpoints,
  topPriority:national.payload.provinces[0]?.province||null,
  topPriorityScore:national.payload.provinces[0]?.priorityScore||0
}));
console.log('TN7_NATIONAL_1_RUNTIME_PASS');
await new Promise(r=>setTimeout(r,5000));
