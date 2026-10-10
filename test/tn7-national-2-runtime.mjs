const api=(process.env.API_BASE||'').replace(/\/$/,'');
const web=(process.env.WEB_BASE||'').replace(/\/$/,'');
const workbench=(process.env.WORKBENCH_BASE||'').replace(/\/$/,'');
if(!api || !web || !workbench) throw new Error('runtime_configuration_missing');

async function json(base,path,{method='GET'}={}){
  const r=await fetch(base+path,{method,cache:'no-store'});
  const text=await r.text();let payload;
  try{payload=text?JSON.parse(text):null}catch{payload=text}
  return {status:r.status,payload,text};
}
function assert(ok,label){if(!ok) throw new Error('FAIL '+label);console.log('PASS '+label);}

const before=await json(api,'/api/v1/network-inventory');
assert(before.status===200,'inventory before NATIONAL-2 proof available');

const kzn=await json(api,'/api/v1/coverage/kzn/execution');
assert(kzn.status===200 && kzn.payload?.mode==='kzn_source_execution','KZN source execution endpoint available');
assert(kzn.payload?.province==='KwaZulu-Natal','KZN execution province explicit');
assert(kzn.payload?.canonicalMutationEnabled===false,'KZN source execution is non-mutating');
assert(kzn.payload?.policy?.spatialProximityAloneIsProof===false,'spatial proximity alone explicitly rejected');
assert(kzn.payload?.policy?.exactRouteCodeRequiredForVerifiedGazetteJoin===true,'verified gazette join requires exact route code');
assert(kzn.payload?.policy?.uniqueAssociationIdentityRequiredForReadyBucket===true,'ready evidence requires unique association identity');
assert(kzn.payload?.policy?.promotionRequiresExistingAdjudicationWorkflow===true,'promotion remains behind adjudication workflow');

const s=kzn.payload.summary||{};
assert(Number(s.ranks)===636,'KZN active rank baseline 636');
assert(Number(s.mapped_ranks)===636,'all KZN active ranks mapped');
assert(Number(s.location_pending)===0,'KZN location pending currently zero');
assert(Number(s.ranks_without_association)===609,'KZN rank association gap measured');
assert(Number(s.associations)===26,'KZN canonical association baseline measured');
assert(Number(s.route_candidates)===1045,'KZN route candidate corpus 1045');
assert(Number(s.route_candidates_without_association)===1045,'all KZN route candidates still association-pending');
assert(Number(s.rank_association_candidates)===29,'KZN rank-association candidate observations measured');

const buckets=kzn.payload.routeCandidateBuckets||{};
assert(Number(buckets.no_association_evidence)===790,'790 route candidates have no endpoint association evidence');
assert(Number(buckets.destination_only)===194,'194 route candidates have destination-only association evidence');
assert(Number(buckets.origin_only)===40,'40 route candidates have origin-only association evidence');
assert(Number(buckets.conflicting_or_multiple)===21,'21 route candidates have conflicting or multiple association evidence');
assert(Object.values(buckets).reduce((a,b)=>a+Number(b||0),0)===1045,'KZN route candidate buckets reconcile to 1045');

const verified=kzn.payload.verifiedGazette||{};
assert(Number(verified.rows)===11,'11 verified gazette evidence rows executed');
assert(Number(verified.buckets?.route_candidate_evidence_ready)===11,'all 11 verified gazette rows are route-candidate evidence ready');
assert((verified.items||[]).every(item=>item.bucket==='route_candidate_evidence_ready'),'every verified row is ready evidence');
assert((verified.items||[]).every(item=>(item.associationMatches||[]).length===1),'every verified row has one canonical association identity');
assert((verified.items||[]).every(item=>(item.routeCandidates||[]).length===1),'every verified row has one exact route candidate');
assert((verified.items||[]).every(item=>(item.canonicalRoutes||[]).length===0),'verified rows do not collide with canonical routes');
assert((verified.items||[]).every(item=>item.canonicalMutation===false),'verified rows remain non-canonical');

const sourceKeys=new Set((kzn.payload.sourceInventory||[]).map(x=>x.source_key));
assert(sourceKeys.has('kzn-taxi-ranks-degraded-tls'),'KZN Department of Transport rank source present');
assert(sourceKeys.has('ethekwini-bus-taxi-ranks-degraded'),'eThekwini official rank source present');

const municipalities=kzn.payload.municipalities||[];
assert(municipalities.some(x=>x.municipality==='eThekwini Metropolitan Municipality'),'eThekwini municipality coverage present');
assert(municipalities.some(x=>x.municipality==='Unknown'),'unresolved KZN municipality attribution remains visible');

const publicKzn=await json(web,'/api/v1/coverage/kzn/execution');
assert(publicKzn.status===200 && publicKzn.payload?.verifiedGazette?.rows===11,'public read-only Web proxies KZN execution model');
const blocked=await json(web,'/api/v1/coverage/kzn/execution',{method:'POST'});
assert(blocked.status===405,'public Web keeps KZN execution endpoint read-only');

const wb=await fetch(workbench+'/',{cache:'no-store'});
const wbHtml=await wb.text();
assert(wb.status===200 && wbHtml.includes('KwaZulu-Natal source execution'),'operator workbench exposes KZN source execution panel');

const after=await json(api,'/api/v1/network-inventory');
assert(after.status===200,'inventory after NATIONAL-2 proof available');
for(const key of ['ranks','mapped_ranks','location_pending_ranks','associations','routes','rank_association_candidates']){
  assert(Number(before.payload[key])===Number(after.payload[key]),'canonical inventory unchanged '+key);
}

console.log('TN7_NATIONAL_2_COUNTS '+JSON.stringify({
  kznRanks:s.ranks,
  kznMappedRanks:s.mapped_ranks,
  kznRanksWithoutAssociation:s.ranks_without_association,
  kznAssociations:s.associations,
  kznRouteCandidates:s.route_candidates,
  kznRouteCandidatesWithoutAssociation:s.route_candidates_without_association,
  verifiedGazetteRows:verified.rows,
  verifiedRouteCandidateEvidenceReady:verified.buckets?.route_candidate_evidence_ready||0
}));
console.log('TN7_NATIONAL_2_SOURCE_EXECUTION_PASS');
console.log('TN7_NATIONAL_2_RUNTIME_PASS');
await new Promise(r=>setTimeout(r,5000));
