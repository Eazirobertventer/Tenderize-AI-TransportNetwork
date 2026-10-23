import { createHmac } from 'node:crypto';
import pg from 'pg';

const { Pool }=pg;
const api=(process.env.API_BASE||'').replace(/\/$/,'');
const secret=process.env.OPERATOR_JWT_SECRET||'';
const issuer=process.env.OPERATOR_JWT_ISSUER||'';
const audience=process.env.OPERATOR_JWT_AUDIENCE||'';
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:false,max:5});

if(!api || secret.length<32 || !issuer || !audience || !process.env.DATABASE_URL){
  throw new Error('runtime_configuration_missing');
}

function b64(value){
  return Buffer.from(value).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
function token(sub,roles){
  const now=Math.floor(Date.now()/1000);
  const h=b64(JSON.stringify({alg:'HS256',typ:'JWT'}));
  const p=b64(JSON.stringify({iss:issuer,aud:audience,sub,roles,iat:now-5,exp:now+1200,jti:sub+'-'+now}));
  const s=createHmac('sha256',secret).update(h+'.'+p).digest('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  return h+'.'+p+'.'+s;
}
async function call(path,{method='POST',bearer=null,key=null,body=null}={}){
  const headers={'content-type':'application/json'};
  if(bearer) headers.authorization='Bearer '+bearer;
  if(key) headers['idempotency-key']=key;
  const response=await fetch(api+path,{method,headers,body:method==='GET'?undefined:JSON.stringify(body||{})});
  const text=await response.text();
  let payload;
  try{payload=JSON.parse(text);}catch{payload=text;}
  return {status:response.status,payload};
}
function assert(ok,label,detail=''){
  if(!ok) throw new Error('FAIL '+label+(detail?' '+detail:''));
  console.log('PASS '+label+(detail?' '+detail:''));
}
async function route(id){
  const r=await pool.query(
    `SELECT id::text,association_id::text,origin_rank_id::text,destination_rank_id::text,
            origin_label,destination_label,route_name,source_route_code,national_route_code,
            board_route_code,route_type,geometry_status,distance_km,verification_status::text,
            confidence,md5(encode(ST_AsEWKB(geometry),'hex')) AS geometry_hash
     FROM taxi_route WHERE id=$1::uuid`,
    [id]
  );
  return r.rows[0]||null;
}
async function routesForCandidate(candidateId){
  const r=await pool.query(
    `SELECT tr.id::text
     FROM route_candidate_promotion rcp
     JOIN taxi_route tr ON tr.id=rcp.route_id
     WHERE rcp.candidate_id=$1::uuid`,
    [candidateId]
  );
  return r.rows;
}
async function promotion(candidateId){
  const r=await pool.query(
    `SELECT id::text,candidate_id::text,source_route_geometry_id::text,route_id::text,
            source_record_id::text,promoted_by_proposal_id::text,promoted_audit_event_id::text
     FROM route_candidate_promotion WHERE candidate_id=$1::uuid`,
    [candidateId]
  );
  return r.rows[0]||null;
}
async function proposal(id){
  const r=await pool.query(
    `SELECT id::text,status,action,target_entity_id::text,intended_change,
            proposer_subject,decision_actor_subject,approved_audit_event_id::text
     FROM operator_decision_proposal WHERE id=$1::uuid`,
    [id]
  );
  return r.rows[0]||null;
}
async function sourceGeometry(id){
  const r=await pool.query(
    `SELECT id::text,promoted_route_id::text,source_payload,
            md5(encode(ST_AsEWKB(geometry),'hex')) AS geometry_hash
     FROM source_route_geometry WHERE id=$1::uuid`,
    [id]
  );
  return r.rows[0]||null;
}
async function sourceRecords(externalRecordId){
  const r=await pool.query(
    `SELECT id::text,entity_id::text,external_record_id,source_payload,
            md5(encode(ST_AsEWKB(source_geometry),'hex')) AS geometry_hash,checksum
     FROM source_record
     WHERE entity_type='taxi_route' AND external_record_id=$1
     ORDER BY id`,
    [externalRecordId]
  );
  return r.rows;
}
async function audits(entityId,action=null){
  const params=[entityId];
  let where='entity_id=$1::uuid';
  if(action){params.push(action);where+=' AND action=$2';}
  const r=await pool.query(
    `SELECT id::text,event_sequence,action,actor_subject,before_state,after_state,evidence,metadata
     FROM operator_audit_event
     WHERE ${where}
     ORDER BY event_sequence`,
    params
  );
  return r.rows;
}
async function candidate(id){
  const r=await pool.query(
    `SELECT id::text,association_id::text,verification_status::text,provenance
     FROM route_candidate WHERE id=$1::uuid`,
    [id]
  );
  return r.rows[0]||null;
}

const reviewer=token('adj6-reviewer',['reviewer']);
const reviewer2=token('adj6-reviewer-2',['reviewer']);
const approver=token('adj6-approver',['approver']);
const approver2=token('adj6-approver-2',['approver']);
const admin=token('adj6-admin',['admin']);

const alpha='21212121-2121-4212-8212-212121212121';
const beta='23232323-2323-4232-8232-232323232323';

const good='71717171-7171-4171-8171-717171717171';
const endpointEvidence='72727272-7272-4272-8272-727272727272';
const assocConflict='73737373-7373-4373-8373-737373737373';
const sharedConflict='74747474-7474-4474-8474-747474747474';
const codeCollision='75757575-7575-4575-8575-757575757575';
const stale='76767676-7676-4676-8676-767676767676';
const race='77777777-aaaa-4777-8777-777777777777';
const atomic='78787878-7878-4878-8878-787878787878';
const sourceRecordExisting='79797979-7979-4979-8979-797979797979';

const goodGeom='61616161-6161-4161-8161-616161616161';
const staleGeom='66666666-aaaa-4666-8666-666666666666';
const raceGeom='67676767-6767-4767-8767-676767676767';
const atomicGeom='68686868-6868-4868-8868-686868686868';

const proposePath=id=>'/api/v1/operator/proposals/route-candidates/'+id+'/promote';
const approvePath=id=>'/api/v1/operator/proposals/'+id+'/approve';
const rejectPath=id=>'/api/v1/operator/proposals/'+id+'/reject';
const body=associationId=>({
  associationId,
  rationale:'Promote exact source-backed route geometry after independent route evidence review.',
  evidence:{review:'route-candidate-source-geometry',gate:'TN7-ADJUDICATION-6'}
});
const approvalBody={
  rationale:'Independent approver verified endpoints, association relationships and source geometry.',
  evidence:{review:'independent-route-promotion-review'}
};

// Access/input boundary.
assert((await call(proposePath(good),{key:'adj6-anon',body:body(alpha)})).status===401,'anonymous route proposal rejected');
assert((await call(proposePath(good),{
  bearer:reviewer,key:'adj6-no-association',
  body:{rationale:'Missing association id must be rejected.',evidence:{proof:true}}
})).status===400,'route promotion requires association id');

// Evidence-only endpoint connector must never promote.
const endpointBlocked=await call(proposePath(endpointEvidence),{
  bearer:reviewer,key:'adj6-endpoint-evidence',body:body(alpha)
});
assert(endpointBlocked.status===409 && endpointBlocked.payload.error==='route_candidate_geometry_evidence_only','endpoint connector geometry blocked from canonical route promotion');

// Candidate explicit association conflicts with selected association.
const assocBlocked=await call(proposePath(assocConflict),{
  bearer:reviewer,key:'adj6-assoc-conflict',body:body(alpha)
});
assert(assocBlocked.status===409 && assocBlocked.payload.error==='route_candidate_association_conflict','candidate association conflict rejected');

// Multiple shared endpoint associations fail closed.
const sharedBlocked=await call(proposePath(sharedConflict),{
  bearer:reviewer,key:'adj6-shared-conflict',body:body(alpha)
});
assert(sharedBlocked.status===409 && sharedBlocked.payload.error==='route_candidate_endpoint_association_conflict','multiple shared endpoint associations rejected');

// Normalized route-code collision with existing canonical route.
const codeBlocked=await call(proposePath(codeCollision),{
  bearer:reviewer,key:'adj6-code-collision',body:body(alpha)
});
assert(codeBlocked.status===409 && codeBlocked.payload.error==='canonical_route_code_collision','canonical route code collision rejected');

// Existing source record already canonical.
const sourceRecordBlocked=await call(proposePath(sourceRecordExisting),{
  bearer:reviewer,key:'adj6-source-record',body:body(alpha)
});
assert(sourceRecordBlocked.status===409 && sourceRecordBlocked.payload.error==='route_candidate_source_record_already_canonical','already-canonical source record blocks promotion');

// Create explicit no-shared-association proof candidate.
await pool.query(
  `INSERT INTO source_route_geometry (
     id,source_id,external_record_id,route_code,province,municipality,category,map_title,
     geometry,verification_status,source_payload
   ) VALUES (
     '83838383-8383-4383-8383-838383838383',
     '33333333-aaaa-4333-8333-333333333333',
     'route-no-shared',
     'R-NOSHARED',
     'Gauteng','Route City','official_route','No Shared Association',
     ST_GeomFromText('MULTILINESTRING((28.90 -26.00,28.91 -26.01))',4326),
     'documented','{}'
   )`
);
await pool.query(
  `INSERT INTO route_candidate (
     id,source_route_geometry_id,source_id,external_record_id,route_code,origin_rank_id,destination_rank_id,
     association_id,origin_distance_m,destination_distance_m,reconciliation_status,verification_status,confidence,provenance
   ) VALUES (
     '84848484-8484-4484-8484-848484848484',
     '83838383-8383-4383-8383-838383838383',
     '33333333-aaaa-4333-8333-333333333333',
     'route-no-shared','R-NOSHARED',
     '27272727-2727-4727-8727-272727272727',
     '35353535-3535-4535-8535-353535353535',
     NULL,0,0,'exact_endpoint_pair','documented',1.0,'{}'
   )`
);
const noShared=await call(proposePath('84848484-8484-4484-8484-848484848484'),{
  bearer:reviewer,key:'adj6-no-shared',body:body(alpha)
});
assert(noShared.status===409 && noShared.payload.error==='route_candidate_association_not_shared_by_endpoints','selected association must be canonical at both endpoints');

// Valid route promotion proposal.
const created=await call(proposePath(good),{
  bearer:reviewer,key:'adj6-good-create',body:body(alpha)
});
assert(created.status===201 && created.payload.replay===false,'valid route promotion proposal created');
const proposalId=created.payload.proposal.id;
assert(created.payload.proposal.intendedChange.candidateId===good,'proposal freezes candidate id');
assert(created.payload.proposal.intendedChange.associationId===alpha,'proposal freezes association id');
assert(created.payload.proposal.intendedChange.geometryHash=== (await sourceGeometry(goodGeom)).geometry_hash,'proposal freezes source geometry hash');
assert((await routesForCandidate(good)).length===0,'proposal creation does not create canonical route');

const reviewerApprove=await call(approvePath(proposalId),{
  bearer:reviewer,key:'adj6-reviewer-approve',body:approvalBody
});
assert(reviewerApprove.status===403,'reviewer cannot approve route promotion');

const approved=await call(approvePath(proposalId),{
  bearer:approver,key:'adj6-good-approve',body:approvalBody
});
assert(approved.status===200 && approved.payload.replay===false,'independent approver promotes canonical route');
const routeId=approved.payload.canonicalMutation.route.id;
const promotedRoute=await route(routeId);
assert(promotedRoute.association_id===alpha,'canonical route association preserved');
assert(promotedRoute.origin_rank_id==='27272727-2727-4727-8727-272727272727' && promotedRoute.destination_rank_id==='28282828-2828-4828-8828-282828282828','canonical route endpoints preserved');
assert(promotedRoute.source_route_code==='R-GOOD','source route code retained explicitly');
assert(promotedRoute.national_route_code===null && promotedRoute.board_route_code===null,'source route code not misclassified as national/board code');
assert(promotedRoute.geometry_status==='source_documented','documented source geometry classified honestly');
assert(promotedRoute.verification_status==='documented','candidate verification classification retained');
assert(promotedRoute.geometry_hash===(await sourceGeometry(goodGeom)).geometry_hash,'canonical geometry exactly matches source geometry');
assert(Number(promotedRoute.distance_km)>0,'canonical route distance calculated from source geometry');

const goodSourceRecords=await sourceRecords('route-good');
assert(goodSourceRecords.length===1 && goodSourceRecords[0].entity_id===routeId,'canonical source_record written');
assert(goodSourceRecords[0].geometry_hash===promotedRoute.geometry_hash,'source record geometry matches canonical geometry');
assert(goodSourceRecords[0].source_payload.routeCandidateId===good,'source record retains route candidate provenance');
assert(goodSourceRecords[0].checksum===promotedRoute.geometry_hash,'source record checksum uses geometry hash');

const goodSrg=await sourceGeometry(goodGeom);
assert(goodSrg.promoted_route_id===routeId,'source route geometry points to canonical route');

const goodPromotion=await promotion(good);
assert(Boolean(goodPromotion),'route promotion lineage written');
assert(goodPromotion.route_id===routeId,'promotion lineage links canonical route');
assert(goodPromotion.source_record_id===goodSourceRecords[0].id,'promotion lineage links source record');
assert(goodPromotion.promoted_by_proposal_id===proposalId,'promotion lineage links proposal');
assert(Boolean(goodPromotion.promoted_audit_event_id),'promotion lineage links canonical audit');

const routeAudits=await audits(routeId,'taxi_route.promote');
assert(routeAudits.length===1,'canonical route promotion audit written once');
assert(routeAudits[0].actor_subject==='adj6-approver','canonical route audit attributed to approver');
assert(routeAudits[0].metadata.dualControl===true,'canonical route audit marks dual control');
assert(routeAudits[0].metadata.candidateId===good,'canonical route audit links candidate');
assert(routeAudits[0].metadata.geometryHash===promotedRoute.geometry_hash,'canonical route audit freezes geometry hash');

assert((await candidate(good)).verification_status==='documented','route candidate source evidence remains documented');
assert((await candidate(good)).association_id===null,'route candidate is not rewritten with canonical association');

// Approval replay is safe.
const replay=await call(approvePath(proposalId),{
  bearer:approver,key:'adj6-good-approve',body:approvalBody
});
assert(replay.status===200 && replay.payload.replay===true,'route approval replay is idempotent');
assert((await routesForCandidate(good)).length===1,'approval replay does not duplicate route');
assert((await audits(routeId,'taxi_route.promote')).length===1,'approval replay does not duplicate canonical audit');

// Same candidate cannot be proposed after promotion.
const secondProposal=await call(proposePath(good),{
  bearer:reviewer2,key:'adj6-good-second',body:body(alpha)
});
assert(secondProposal.status===409 && secondProposal.payload.error==='route_candidate_already_promoted','promoted route candidate cannot be proposed again');

// Exact endpoint duplicate blocks a different candidate.
await pool.query(
  `INSERT INTO source_route_geometry (
     id,source_id,external_record_id,route_code,province,municipality,category,map_title,
     geometry,verification_status,source_payload
   ) VALUES (
     '85858585-8585-4585-8585-858585858585',
     '33333333-aaaa-4333-8333-333333333333',
     'route-endpoint-duplicate',
     'R-DIFFERENT',
     'Gauteng','Route City','official_route','Duplicate Endpoint Route',
     ST_GeomFromText('MULTILINESTRING((28.00 -26.00,28.03 -26.03))',4326),
     'documented','{}'
   )`
);
await pool.query(
  `INSERT INTO route_candidate (
     id,source_route_geometry_id,source_id,external_record_id,route_code,origin_rank_id,destination_rank_id,
     association_id,origin_distance_m,destination_distance_m,reconciliation_status,verification_status,confidence,provenance
   ) VALUES (
     '86868686-8686-4686-8686-868686868686',
     '85858585-8585-4585-8585-858585858585',
     '33333333-aaaa-4333-8333-333333333333',
     'route-endpoint-duplicate','R-DIFFERENT',
     '27272727-2727-4727-8727-272727272727',
     '28282828-2828-4828-8828-282828282828',
     NULL,0,0,'exact_endpoint_pair','documented',1.0,'{}'
   )`
);
const endpointDuplicate=await call(proposePath('86868686-8686-4686-8686-868686868686'),{
  bearer:reviewer,key:'adj6-endpoint-duplicate',body:body(alpha)
});
assert(endpointDuplicate.status===409 && endpointDuplicate.payload.error==='canonical_route_endpoint_duplicate','same association and ordered endpoints cannot create duplicate canonical route');

// Stale source geometry evidence blocks approval.
const staleProposal=await call(proposePath(stale),{
  bearer:reviewer,key:'adj6-stale-create',body:body(alpha)
});
assert(staleProposal.status===201,'stale route proposal created');
await pool.query(
  `UPDATE source_route_geometry
   SET source_payload=source_payload || '{"newEvidence":"changed-after-proposal"}'::jsonb,
       last_seen_at=now()
   WHERE id=$1::uuid`,
  [staleGeom]
);
const staleApproval=await call(approvePath(staleProposal.payload.proposal.id),{
  bearer:approver,key:'adj6-stale-approve',body:approvalBody
});
assert(staleApproval.status===409 && staleApproval.payload.error==='decision_proposal_stale_before_state','changed route evidence makes proposal stale');
assert((await routesForCandidate(stale)).length===0,'stale route proposal creates no canonical route');
assert((await proposal(staleProposal.payload.proposal.id)).status==='proposed','stale route proposal remains pending');

// Proposal rejection creates no route.
const rejectProposal=await call(proposePath(stale),{
  bearer:reviewer2,key:'adj6-reject-create',body:body(alpha)
});
assert(rejectProposal.status===201,'route reject-test proposal created from current evidence');
const rejected=await call(rejectPath(rejectProposal.payload.proposal.id),{
  bearer:approver,key:'adj6-reject-decision',
  body:{rationale:'Independent review rejects this route promotion proposal.',evidence:{reason:'route-evidence-insufficient'}}
});
assert(rejected.status===200 && rejected.payload.proposal.status==='rejected','route proposal rejected');
assert((await routesForCandidate(stale)).length===0,'rejected route proposal creates no canonical route');

// Concurrent duplicate promotion: one winner.
const raceOne=await call(proposePath(race),{
  bearer:reviewer,key:'adj6-race-create-one',body:body(alpha)
});
const raceTwo=await call(proposePath(race),{
  bearer:reviewer2,key:'adj6-race-create-two',body:body(alpha)
});
assert(raceOne.status===201 && raceTwo.status===201,'duplicate route proposals can coexist before approval');

const raceResults=await Promise.all([
  call(approvePath(raceOne.payload.proposal.id),{bearer:approver,key:'adj6-race-approve-one',body:approvalBody}),
  call(approvePath(raceTwo.payload.proposal.id),{bearer:approver2,key:'adj6-race-approve-two',body:approvalBody})
]);
const raceStatuses=raceResults.map(x=>x.status).sort((a,b)=>a-b);
assert(raceStatuses[0]===200 && raceStatuses[1]===409,'concurrent duplicate route approvals yield one winner');
assert((await routesForCandidate(race)).length===1,'concurrent route race creates one canonical route');
assert(Boolean(await promotion(race)),'concurrent route race creates one promotion lineage row');
assert((await sourceGeometry(raceGeom)).promoted_route_id!==null,'concurrent winner marks source geometry promoted');

// Atomic rollback across canonical route, source record, source geometry pointer, lineage and proposal.
const atomicProposal=await call(proposePath(atomic),{
  bearer:reviewer,key:'adj6-atomic-create',body:body(alpha)
});
assert(atomicProposal.status===201,'atomic route proposal created');

await pool.query("ALTER TABLE operator_audit_event ADD CONSTRAINT tn7_adj6_force_approval_audit_failure CHECK (action <> 'decision_proposal.approve') NOT VALID");
const atomicApproval=await call(approvePath(atomicProposal.payload.proposal.id),{
  bearer:approver,key:'adj6-atomic-approve',body:approvalBody
});
assert(atomicApproval.status===500,'forced route approval audit failure returns server error');
assert((await routesForCandidate(atomic)).length===0,'canonical route insert rolled back');
assert((await sourceRecords('route-atomic')).length===0,'canonical source record rolled back');
assert((await sourceGeometry(atomicGeom)).promoted_route_id===null,'source geometry promotion pointer rolled back');
assert((await promotion(atomic))===null,'route promotion lineage rolled back');
assert((await proposal(atomicProposal.payload.proposal.id)).status==='proposed','route proposal approval state rolled back');
const atomicAudit=await pool.query(
  `SELECT count(*)::int AS count
   FROM operator_audit_event
   WHERE action='taxi_route.promote'
     AND metadata->>'candidateId'=$1`,
  [atomic]
);
assert(atomicAudit.rows[0].count===0,'canonical route audit rolled back');
await pool.query('ALTER TABLE operator_audit_event DROP CONSTRAINT tn7_adj6_force_approval_audit_failure');
console.log('TN7_ADJ6_ATOMIC_ROUTE_ROLLBACK_PASS');

// Database lineage uniqueness backstop.
let lineageUniqueBlocked=false;
try{
  const p=await promotion(good);
  await pool.query(
    `INSERT INTO route_candidate_promotion (
       candidate_id,source_route_geometry_id,route_id,source_record_id,promoted_by_proposal_id,promoted_audit_event_id
     ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid)`,
    [good,p.source_route_geometry_id,p.route_id,p.source_record_id,p.promoted_by_proposal_id,p.promoted_audit_event_id]
  );
}catch(error){ lineageUniqueBlocked=String(error.message).toLowerCase().includes('unique'); }
assert(lineageUniqueBlocked,'route promotion lineage uniqueness blocks duplicate insert');
console.log('TN7_ADJ6_ROUTE_UNIQUENESS_PASS');

// Audit sequence remains monotonic.
const seq=await pool.query('SELECT event_sequence FROM operator_audit_event ORDER BY event_sequence');
for(let i=1;i<seq.rows.length;i++){
  if(Number(seq.rows[i].event_sequence)<=Number(seq.rows[i-1].event_sequence)){
    throw new Error('audit_sequence_not_monotonic');
  }
}
console.log('TN7_ADJ6_AUDIT_SEQUENCE_PASS '+seq.rows.length);

const canonicalCount=await pool.query('SELECT count(*)::int AS count FROM taxi_route');
const promotionCount=await pool.query('SELECT count(*)::int AS count FROM route_candidate_promotion');
console.log('TN7_ADJ6_CANONICAL_ROUTES '+canonicalCount.rows[0].count);
console.log('TN7_ADJ6_PROMOTIONS '+promotionCount.rows[0].count);
console.log('TN7_ADJ6_RUNTIME_PASS');

await pool.end();
await new Promise(resolve=>setTimeout(resolve,10000));
