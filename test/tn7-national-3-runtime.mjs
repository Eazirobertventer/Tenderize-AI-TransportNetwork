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
assert(before.status===200,'inventory before NATIONAL-3 proof available');

const queue=await json(api,'/api/v1/coverage/kzn/gazette-queue?limit=250');
assert(queue.status===200 && queue.payload?.mode==='kzn_gazette_evidence_queue','KZN gazette evidence queue available');
assert(queue.payload?.province==='KwaZulu-Natal','queue province explicit');
assert(queue.payload?.canonicalMutationEnabled===false,'canonical mutation disabled');
assert(queue.payload?.automaticPromotionEnabled===false,'automatic promotion disabled');
assert(queue.payload?.policy?.exactRouteCodeRequired===true,'queue requires exact route code');
assert(queue.payload?.policy?.uniqueCanonicalAssociationRequiredForReady===true,'ready bucket requires unique canonical association');
assert(queue.payload?.policy?.indexedEvidenceMustStillBeOperatorReviewed===true,'indexed evidence remains operator-reviewed');
assert(queue.payload?.policy?.promotionRoute==='existing_ADJ5_ADJ6_workflows','promotion remains in ADJ5 ADJ6');

const evidence=queue.payload.evidence||{};
assert(Number(evidence.total)===19,'queue contains 19 evidence rows');
assert(Number(evidence.origins?.verified_seed)===11,'original 11 verified seed rows preserved');
assert(Number(evidence.origins?.indexed_gazette_text)===8,'NATIONAL-3 adds 8 indexed gazette rows');
assert(Number(evidence.buckets?.route_candidate_evidence_ready)===13,'13 rows are route candidate evidence ready');
assert(Number(evidence.buckets?.route_code_not_in_candidate_corpus)===3,'3 exact gazette route codes are absent from candidate corpus');
assert(Number(evidence.buckets?.association_identity_pending)===3,'3 rows have unresolved canonical association identity');
assert(Number(evidence.readyForControlledReview)===13,'13 rows ready for controlled review');

const items=queue.payload.queue?.items||[];
assert(items.length===19,'bounded queue returns all 19 current rows');
assert(items.every(item=>item.canonicalMutation===false),'every queue row remains non-canonical');

const seed=items.filter(item=>item.evidenceOrigin==='verified_seed');
assert(seed.length===11 && seed.every(item=>item.bucket==='route_candidate_evidence_ready'),'all 11 seed rows remain evidence ready');

const indexed=items.filter(item=>item.evidenceOrigin==='indexed_gazette_text');
assert(indexed.length===8,'8 indexed expansion rows returned');

const indexedReady=indexed.filter(item=>item.bucket==='route_candidate_evidence_ready').map(item=>item.routeCode).sort();
assert(JSON.stringify(indexedReady)===JSON.stringify(['KZNBRC0059','KZNBRCLDY0201'].sort()),'two new indexed rows are deterministically evidence ready');

for(const code of ['KZNBRC0059','KZNBRCLDY0201']){
  const item=items.find(x=>x.routeCode===code);
  assert(item && item.associationMatches.length===1 && item.routeCandidates.length===1 && item.canonicalRoutes.length===0,'ready row '+code+' has one association, one candidate, zero canonical collisions');
  assert(item.adjudicationRequired===true,'ready row '+code+' requires adjudication');
}

for(const code of ['KZNBRCLDY0052','KZNBRCLDY0059','KZNBRCLDY0200']){
  const item=items.find(x=>x.routeCode===code);
  assert(item?.bucket==='route_code_not_in_candidate_corpus','missing candidate corpus route retained '+code);
  assert(item?.associationMatches?.length===1,'missing candidate route still has unique Dundee association '+code);
}

for(const code of ['KZNBRCPMB100','KZNBRCPMB102','KZNBRCPMB103']){
  const item=items.find(x=>x.routeCode===code);
  assert(item?.bucket==='association_identity_pending','Bhamshela association identity remains pending '+code);
  assert(item?.associationMatches?.length===0,'Bhamshela row does not invent canonical association '+code);
  assert(item?.adjudicationRequired===false,'Bhamshela row cannot enter deterministic adjudication '+code);
}

const b103=items.find(x=>x.routeCode==='KZNBRCPMB103');
assert(b103?.routeCandidates?.length===1,'KZNBRCPMB103 candidate exists but remains blocked on association identity');

assert(queue.payload.sourceAvailability?.directPdfBatch?.attempted===13,'13-document direct PDF batch recorded');
assert(queue.payload.sourceAvailability?.directPdfBatch?.succeeded===0,'remote PDF batch success remains zero');
assert(queue.payload.sourceAvailability?.directPdfBatch?.blockedByRemoteHosts===true,'remote PDF host block is explicit');
assert(queue.payload.sourceAvailability?.indexedGazetteRecovery===true,'indexed gazette recovery path active');

const publicQueue=await json(web,'/api/v1/coverage/kzn/gazette-queue?limit=250');
assert(publicQueue.status===200 && Number(publicQueue.payload?.evidence?.total)===19,'public Web proxies read-only gazette queue');
const blocked=await json(web,'/api/v1/coverage/kzn/gazette-queue',{method:'POST'});
assert(blocked.status===405,'public Web keeps gazette queue read-only');

const wb=await fetch(workbench+'/',{cache:'no-store'});
const wbHtml=await wb.text();
assert(wb.status===200 && wbHtml.includes('KZN Gazette Evidence Queue'),'operator workbench exposes NATIONAL-3 queue panel');

const after=await json(api,'/api/v1/network-inventory');
assert(after.status===200,'inventory after NATIONAL-3 proof available');
for(const key of ['ranks','mapped_ranks','location_pending_ranks','associations','routes','rank_association_candidates']){
  assert(Number(before.payload[key])===Number(after.payload[key]),'canonical inventory unchanged '+key);
}

console.log('TN7_NATIONAL_3_COUNTS '+JSON.stringify({
  totalEvidence:evidence.total,
  verifiedSeed:evidence.origins?.verified_seed,
  indexedExpansion:evidence.origins?.indexed_gazette_text,
  routeCandidateEvidenceReady:evidence.buckets?.route_candidate_evidence_ready,
  newIndexedEvidenceReady:indexedReady.length,
  routeCodesMissingFromCandidateCorpus:evidence.buckets?.route_code_not_in_candidate_corpus,
  associationIdentityPending:evidence.buckets?.association_identity_pending
}));
console.log('TN7_NATIONAL_3_EVIDENCE_QUEUE_PASS');
console.log('TN7_NATIONAL_3_RUNTIME_PASS');
await new Promise(resolve=>setTimeout(resolve,5000));
