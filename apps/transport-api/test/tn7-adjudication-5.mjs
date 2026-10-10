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
async function relations(rankId){
  const r=await pool.query(
    `SELECT relationship_id::text,taxi_rank_id::text,association_id::text,
            verification_status::text,confidence
     FROM taxi_rank_association
     WHERE taxi_rank_id=$1::uuid
     ORDER BY association_id`,
    [rankId]
  );
  return r.rows;
}
async function promotion(candidateId){
  const r=await pool.query(
    `SELECT id::text,candidate_id::text,relationship_id::text,taxi_rank_id::text,
            association_id::text,promoted_by_proposal_id::text,promoted_audit_event_id::text
     FROM rank_association_promotion
     WHERE candidate_id=$1::uuid`,
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
  return r.rows[0];
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
    'SELECT id::text,verification_status,association_label,normalized_label FROM rank_association_candidate WHERE id=$1::uuid',
    [id]
  );
  return r.rows[0];
}

const reviewer=token('adj5-reviewer',['reviewer']);
const reviewer2=token('adj5-reviewer-2',['reviewer']);
const approver=token('adj5-approver',['approver']);
const approver2=token('adj5-approver-2',['approver']);
const admin=token('adj5-admin',['admin']);

const alpha='21212121-2121-4212-8212-212121212121';
const beta='23232323-2323-4232-8232-232323232323';
const gamma='24242424-2424-4242-8242-242424242424';

const central='14141414-1414-4414-8414-141414141414';
const west='15151515-1515-4515-8515-151515151515';
const north='16161616-1616-4616-8616-161616161616';
const south='17171717-1717-4717-8717-171717171717';
const east='18181818-1818-4818-8818-181818181818';
const airport='19191919-1919-4919-8919-191919191919';
const atomicRank='20202020-2020-4020-8020-202020202020';
const rejectRank='25252525-2525-4525-8525-252525252525';
const multiRank='26262626-2626-4626-8626-262626262626';

const centralCandidate='41414141-4141-4141-8141-414141414141';
const westAlpha='43434343-4343-4343-8343-434343434343';
const northUnknown='46464646-4646-4646-8646-464646464646';
const southAlpha='47474747-4747-4747-8747-474747474747';
const eastAlpha='48484848-4848-4848-8848-484848484848';
const airportGamma='49494949-4949-4949-8949-494949494949';
const atomicBeta='50505050-5050-4050-8050-505050505050';
const rejectAlpha='51515151-5151-4151-8151-515151515151';
const multiAlpha='52525252-5252-4252-8252-525252525252';

const proposePath=id=>'/api/v1/operator/proposals/rank-association-candidates/'+id+'/assign';
const approvePath=id=>'/api/v1/operator/proposals/'+id+'/approve';
const rejectPath=id=>'/api/v1/operator/proposals/'+id+'/reject';
const body=associationId=>({
  associationId,
  rationale:'Promote documented association evidence into a reviewed canonical operating relationship.',
  evidence:{review:'candidate-source-evidence',gate:'TN7-ADJUDICATION-5'}
});
const approvalBody={
  rationale:'Independent approver verified rank, association and candidate evidence.',
  evidence:{review:'independent-relationship-review'}
};

// Access and input boundary.
assert((await call(proposePath(centralCandidate),{key:'adj5-anon',body:body(alpha)})).status===401,'anonymous assignment proposal rejected');
assert((await call(proposePath(centralCandidate),{
  bearer:reviewer,key:'adj5-no-association',
  body:{rationale:'Missing association id must be rejected.',evidence:{proof:true}}
})).status===400,'association id required');

// Candidate label must bind to target association identity.
const mismatch=await call(proposePath(northUnknown),{
  bearer:reviewer,key:'adj5-mismatch',body:body(alpha)
});
assert(mismatch.status===409 && mismatch.payload.error==='rank_association_candidate_identity_mismatch','candidate identity mismatch rejected');

// Competing unresolved evidence blocks proposal.
const conflict=await call(proposePath(westAlpha),{
  bearer:reviewer,key:'adj5-conflict',body:body(alpha)
});
assert(conflict.status===409 && conflict.payload.error==='rank_association_candidate_conflict','competing candidate association evidence blocks proposal');
assert(conflict.payload.competingCandidateLabels.includes('beta taxi association'),'conflict returns competing normalized label');

// Existing exact canonical link blocks duplicate promotion.
const duplicate=await call(proposePath(southAlpha),{
  bearer:reviewer,key:'adj5-existing-link',body:body(alpha)
});
assert(duplicate.status===409 && duplicate.payload.error==='rank_association_relationship_exists','existing canonical relationship blocks duplicate proposal');

// Valid proposal with two candidate labels that both map to same association identity.
const created=await call(proposePath(centralCandidate),{
  bearer:reviewer,key:'adj5-central-create',body:body(alpha)
});
assert(created.status===201 && created.payload.replay===false,'valid assignment proposal created');
const centralProposalId=created.payload.proposal.id;
assert(created.payload.proposal.intendedChange.taxiRankId===central,'proposal freezes canonical rank id');
assert(created.payload.proposal.intendedChange.associationId===alpha,'proposal freezes target association id');
assert((await relations(central)).length===0,'proposal creation does not create relationship');

const selfApproval=await call(approvePath(centralProposalId),{
  bearer:reviewer,key:'adj5-reviewer-approve',body:approvalBody
});
assert(selfApproval.status===403,'reviewer cannot approve assignment proposal');

const approved=await call(approvePath(centralProposalId),{
  bearer:approver,key:'adj5-central-approve',body:approvalBody
});
assert(approved.status===200 && approved.payload.replay===false,'independent approver assigns canonical association');
const centralRelations=await relations(central);
assert(centralRelations.length===1 && centralRelations[0].association_id===alpha,'canonical relationship inserted');
assert(centralRelations[0].verification_status==='verified','approved relationship stored verified');
assert(Boolean(centralRelations[0].relationship_id),'canonical relationship has stable UUID');

const centralPromotion=await promotion(centralCandidate);
assert(Boolean(centralPromotion),'promotion lineage row written');
assert(centralPromotion.relationship_id===centralRelations[0].relationship_id,'promotion links exact canonical relationship');
assert(centralPromotion.promoted_by_proposal_id===centralProposalId,'promotion links proposal');
assert(Boolean(centralPromotion.promoted_audit_event_id),'promotion links canonical audit');

const centralAudit=await audits(centralRelations[0].relationship_id,'taxi_rank_association.assign');
assert(centralAudit.length===1,'canonical assignment audit written once');
assert(centralAudit[0].actor_subject==='adj5-approver','canonical assignment attributed to approver');
assert(centralAudit[0].metadata.dualControl===true,'canonical assignment audit marks dual control');
assert(centralAudit[0].metadata.candidateId===centralCandidate,'canonical audit links evidence candidate');
assert(centralAudit[0].metadata.taxiRankId===central && centralAudit[0].metadata.associationId===alpha,'canonical audit links rank and association');

assert((await candidate(centralCandidate)).verification_status==='documented','source candidate evidence remains immutable/documented');

const replay=await call(approvePath(centralProposalId),{
  bearer:approver,key:'adj5-central-approve',body:approvalBody
});
assert(replay.status===200 && replay.payload.replay===true,'assignment approval replay is idempotent');
assert((await relations(central)).length===1,'approval replay does not duplicate relationship');
assert((await audits(centralRelations[0].relationship_id,'taxi_rank_association.assign')).length===1,'approval replay does not duplicate canonical audit');

const promotedAgain=await call(proposePath(centralCandidate),{
  bearer:reviewer2,key:'adj5-central-second-proposal',body:body(alpha)
});
assert(promotedAgain.status===409 && promotedAgain.payload.error==='rank_association_candidate_already_promoted','promoted candidate cannot create second proposal');

// Existing relationship to another association does not imply exclusivity.
const multiProposal=await call(proposePath(multiAlpha),{
  bearer:reviewer,key:'adj5-multi-create',body:body(alpha)
});
assert(multiProposal.status===201,'rank with another canonical association may propose additional operating association');
const multiApproved=await call(approvePath(multiProposal.payload.proposal.id),{
  bearer:admin,key:'adj5-multi-approve',body:approvalBody
});
assert(multiApproved.status===200,'additional operating association approved');
const multiRelations=await relations(multiRank);
assert(multiRelations.length===2,'many-to-many operating relationship semantics preserved');
assert(multiRelations.some(x=>x.association_id===alpha) && multiRelations.some(x=>x.association_id===beta),'both operating associations retained');

// Evidence set changes after proposal make it stale.
const staleProposal=await call(proposePath(eastAlpha),{
  bearer:reviewer,key:'adj5-stale-create',body:body(alpha)
});
assert(staleProposal.status===201,'stale evidence proposal created');
await pool.query(
  `INSERT INTO rank_association_candidate (
     id,source_id,source_rank_external_id,taxi_rank_id,association_label,normalized_label,verification_status
   ) VALUES (
     '53535353-5353-4353-8353-535353535353',
     '32323232-3232-4232-8232-323232323232',
     'east-a-second',
     $1::uuid,
     'ATA',
     'ata',
     'documented'
   )`,
  [east]
);
const staleApproval=await call(approvePath(staleProposal.payload.proposal.id),{
  bearer:approver,key:'adj5-stale-approve',body:approvalBody
});
assert(staleApproval.status===409 && staleApproval.payload.error==='decision_proposal_stale_before_state','new candidate evidence makes proposal stale');
assert((await relations(east)).length===0,'stale proposal leaves canonical relationship unchanged');
assert((await proposal(staleProposal.payload.proposal.id)).status==='proposed','stale proposal remains pending');

// Proposal rejection does not create relationship.
const rejectProposal=await call(proposePath(rejectAlpha),{
  bearer:reviewer,key:'adj5-reject-create',body:body(alpha)
});
assert(rejectProposal.status===201,'assignment reject-test proposal created');
const rejected=await call(rejectPath(rejectProposal.payload.proposal.id),{
  bearer:approver,key:'adj5-reject-decision',
  body:{rationale:'Independent review rejects this association assignment proposal.',evidence:{reason:'evidence-insufficient'}}
});
assert(rejected.status===200 && rejected.payload.proposal.status==='rejected','assignment proposal rejected');
assert((await relations(rejectRank)).length===0,'rejected proposal creates no canonical relationship');

// Concurrent duplicate proposals for same evidence: exactly one approval wins.
const raceOne=await call(proposePath(airportGamma),{
  bearer:reviewer,key:'adj5-race-create-one',body:body(gamma)
});
const raceTwo=await call(proposePath(airportGamma),{
  bearer:reviewer2,key:'adj5-race-create-two',body:body(gamma)
});
assert(raceOne.status===201 && raceTwo.status===201,'duplicate evidence proposals can coexist before approval');

const race=await Promise.all([
  call(approvePath(raceOne.payload.proposal.id),{bearer:approver,key:'adj5-race-approve-one',body:approvalBody}),
  call(approvePath(raceTwo.payload.proposal.id),{bearer:approver2,key:'adj5-race-approve-two',body:approvalBody})
]);
const raceStatuses=race.map(x=>x.status).sort((a,b)=>a-b);
assert(raceStatuses[0]===200 && raceStatuses[1]===409,'concurrent duplicate assignment approvals yield one winner');
assert((await relations(airport)).length===1,'concurrent assignment race creates one relationship');
assert(Boolean(await promotion(airportGamma)),'concurrent assignment race creates one promotion lineage row');

// Atomic rollback across relationship, canonical audit, promotion and proposal approval.
const atomicProposal=await call(proposePath(atomicBeta),{
  bearer:reviewer,key:'adj5-atomic-create',body:body(beta)
});
assert(atomicProposal.status===201,'atomic assignment proposal created');

await pool.query("ALTER TABLE operator_audit_event ADD CONSTRAINT tn7_adj5_force_approval_audit_failure CHECK (action <> 'decision_proposal.approve') NOT VALID");
const atomicApproval=await call(approvePath(atomicProposal.payload.proposal.id),{
  bearer:approver,key:'adj5-atomic-approve',body:approvalBody
});
assert(atomicApproval.status===500,'forced final approval audit failure returns server error');
assert((await relations(atomicRank)).length===0,'canonical relationship insert rolled back');
assert((await promotion(atomicBeta))===null,'promotion lineage insert rolled back');
assert((await proposal(atomicProposal.payload.proposal.id)).status==='proposed','proposal approval state rolled back');

const atomicCanonicalAudit=await pool.query(
  `SELECT count(*)::int AS count
   FROM operator_audit_event
   WHERE action='taxi_rank_association.assign'
     AND metadata->>'candidateId'=$1`,
  [atomicBeta]
);
assert(atomicCanonicalAudit.rows[0].count===0,'canonical assignment audit rolled back');
await pool.query('ALTER TABLE operator_audit_event DROP CONSTRAINT tn7_adj5_force_approval_audit_failure');
console.log('TN7_ADJ5_ATOMIC_ASSIGNMENT_ROLLBACK_PASS');

// Relationship/promotion uniqueness database backstops.
let duplicateRelationBlocked=false;
try{
  await pool.query(
    `INSERT INTO taxi_rank_association (taxi_rank_id,association_id,verification_status)
     VALUES ($1::uuid,$2::uuid,'verified')`,
    [central,alpha]
  );
}catch(error){ duplicateRelationBlocked=String(error.message).toLowerCase().includes('unique'); }
assert(duplicateRelationBlocked,'canonical composite key blocks duplicate relationship');

let duplicatePromotionBlocked=false;
try{
  await pool.query(
    `INSERT INTO rank_association_promotion (
       candidate_id,relationship_id,taxi_rank_id,association_id,promoted_by_proposal_id,promoted_audit_event_id
     ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid)`,
    [
      centralCandidate,
      centralPromotion.relationship_id,
      central,
      alpha,
      centralProposalId,
      centralPromotion.promoted_audit_event_id
    ]
  );
}catch(error){ duplicatePromotionBlocked=String(error.message).toLowerCase().includes('unique'); }
assert(duplicatePromotionBlocked,'promotion lineage uniqueness blocks replay outside API');
console.log('TN7_ADJ5_RELATIONSHIP_UNIQUENESS_PASS');

// Audit sequence remains monotonic.
const seq=await pool.query('SELECT event_sequence FROM operator_audit_event ORDER BY event_sequence');
for(let i=1;i<seq.rows.length;i++){
  if(Number(seq.rows[i].event_sequence)<=Number(seq.rows[i-1].event_sequence)){
    throw new Error('audit_sequence_not_monotonic');
  }
}
console.log('TN7_ADJ5_AUDIT_SEQUENCE_PASS '+seq.rows.length);

const relationshipCount=await pool.query('SELECT count(*)::int AS count FROM taxi_rank_association');
const promotionCount=await pool.query('SELECT count(*)::int AS count FROM rank_association_promotion');
console.log('TN7_ADJ5_RELATIONSHIPS '+relationshipCount.rows[0].count);
console.log('TN7_ADJ5_PROMOTIONS '+promotionCount.rows[0].count);
console.log('TN7_ADJ5_RUNTIME_PASS');

await pool.end();
await new Promise(resolve=>setTimeout(resolve,10000));
