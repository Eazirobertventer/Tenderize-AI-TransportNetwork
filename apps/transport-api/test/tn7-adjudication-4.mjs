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
async function rank(id){
  const r=await pool.query('SELECT id::text,canonical_name,aliases,address,updated_at FROM taxi_rank WHERE id=$1::uuid',[id]);
  return r.rows[0];
}
async function association(id){
  const r=await pool.query('SELECT id::text,canonical_name,acronym,aliases,address,updated_at FROM taxi_association WHERE id=$1::uuid',[id]);
  return r.rows[0];
}
async function proposal(id){
  const r=await pool.query(
    `SELECT id::text,status,action,target_entity_type,target_entity_id::text,intended_change,
            proposer_subject,decision_actor_subject,approved_audit_event_id::text
     FROM operator_decision_proposal WHERE id=$1::uuid`,
    [id]
  );
  return r.rows[0];
}
async function aliasRows(entityType=null,normalized=null){
  const params=[];
  const where=[];
  if(entityType){params.push(entityType);where.push('entity_type=$'+params.length);}
  if(normalized){params.push(normalized);where.push('normalized_alias=$'+params.length);}
  const r=await pool.query(
    `SELECT id::text,entity_type,entity_id::text,alias,normalized_alias,
            promoted_by_proposal_id::text,promoted_audit_event_id::text
     FROM transport_entity_alias
     ${where.length?'WHERE '+where.join(' AND '):''}
     ORDER BY created_at,id`,
    params
  );
  return r.rows;
}
async function audits(entityId,action=null){
  const params=[entityId];
  let where='entity_id=$1::uuid';
  if(action){params.push(action);where+=' AND action=$2';}
  const r=await pool.query(
    `SELECT id::text,event_sequence,action,actor_subject,before_state,after_state,metadata
     FROM operator_audit_event
     WHERE ${where}
     ORDER BY event_sequence`,
    params
  );
  return r.rows;
}

const reviewer=token('adj4-reviewer',['reviewer']);
const reviewer2=token('adj4-reviewer-2',['reviewer']);
const approver=token('adj4-approver',['approver']);
const approver2=token('adj4-approver-2',['approver']);
const admin=token('adj4-admin',['admin']);

const central='14141414-1414-4414-8414-141414141414';
const west='15151515-1515-4515-8515-151515151515';
const north='16161616-1616-4616-8616-161616161616';
const south='17171717-1717-4717-8717-171717171717';
const east='18181818-1818-4818-8818-181818181818';
const airport='19191919-1919-4919-8919-191919191919';
const alpha='21212121-2121-4212-8212-212121212121';
const beta='23232323-2323-4232-8232-232323232323';
const gamma='24242424-2424-4242-8242-242424242424';

const rankAliasPath=id=>'/api/v1/operator/proposals/ranks/'+id+'/aliases';
const assocAliasPath=id=>'/api/v1/operator/proposals/associations/'+id+'/aliases';
const approvePath=id=>'/api/v1/operator/proposals/'+id+'/approve';
const rejectPath=id=>'/api/v1/operator/proposals/'+id+'/reject';

const proposalBody=alias=>({
  alias,
  rationale:'Promote source-backed alternate identity after evidence review.',
  evidence:{source:'tn7-adj4-proof',evidenceType:'documented-alternate-name'}
});
const decisionBody={
  rationale:'Independent approver confirmed alias identity and collision checks.',
  evidence:{review:'independent-identity-review'}
};

// Access + input boundaries.
assert((await call(rankAliasPath(central),{key:'adj4-anon',body:proposalBody('Central Hub')})).status===401,'anonymous alias proposal rejected');
assert((await call(rankAliasPath(central),{bearer:reviewer,key:'adj4-no-evidence',body:{
  alias:'Central Hub',rationale:'Proposal without evidence must fail.'
}})).status===400,'alias proposal requires evidence');
assert((await call(rankAliasPath(central),{bearer:reviewer,key:'adj4-short-alias',body:proposalBody('A')})).status===400,'short alias rejected');

// Collision with own canonical identity.
const ownCanonical=await call(rankAliasPath(central),{
  bearer:reviewer,key:'adj4-own-canonical',body:proposalBody('  CENTRAL   TAXI   RANK  ')
});
assert(ownCanonical.status===409 && ownCanonical.payload.error==='alias_already_present_or_identity','own canonical name cannot be promoted as alias');

// Collision with another entity canonical name.
const canonicalCollision=await call(rankAliasPath(central),{
  bearer:reviewer,key:'adj4-canonical-collision',body:proposalBody(' west   TAXI rank ')
});
assert(canonicalCollision.status===409 && canonicalCollision.payload.error==='alias_collision','other rank canonical name collision rejected');
assert(canonicalCollision.payload.collision.kind==='canonical_name','canonical collision classified');

// Collision with legacy alias.
const legacyCollision=await call(rankAliasPath(west),{
  bearer:reviewer,key:'adj4-legacy-collision',body:proposalBody(' central   rank ')
});
assert(legacyCollision.status===409 && legacyCollision.payload.error==='alias_collision','legacy rank alias collision rejected');
assert(legacyCollision.payload.collision.kind==='alias','legacy alias collision classified');

// Unicode NFKC collision against association acronym ATA.
const unicodeCollision=await call(assocAliasPath(beta),{
  bearer:reviewer,key:'adj4-nfkc-collision',body:proposalBody('ＡＴＡ')
});
assert(unicodeCollision.status===409 && unicodeCollision.payload.error==='alias_collision','NFKC equivalent acronym collision rejected');
assert(unicodeCollision.payload.collision.kind==='acronym','NFKC collision classified as acronym');

// Valid rank alias proposal normalizes whitespace/case and requires a second actor.
const rankProposal=await call(rankAliasPath(central),{
  bearer:reviewer,key:'adj4-rank-create',body:proposalBody('  Central   Hub  ')
});
assert(rankProposal.status===201,'rank alias proposal created');
const rankProposalId=rankProposal.payload.proposal.id;
assert(rankProposal.payload.proposal.intendedChange.alias==='Central Hub','rank alias whitespace normalized');
assert(rankProposal.payload.proposal.intendedChange.normalizedAlias==='central hub','rank normalized alias stored');
assert(!(await rank(central)).aliases.includes('Central Hub'),'proposal creation does not mutate rank');

const selfApprove=await call(approvePath(rankProposalId),{
  bearer:reviewer,key:'adj4-reviewer-cannot-approve',body:decisionBody
});
assert(selfApprove.status===403,'reviewer cannot approve alias proposal');

const approvedRank=await call(approvePath(rankProposalId),{
  bearer:approver,key:'adj4-rank-approve',body:decisionBody
});
assert(approvedRank.status===200 && approvedRank.payload.replay===false,'independent approver promotes rank alias');
assert((await rank(central)).aliases.includes('Central Hub'),'rank alias array updated');
const rankRegistry=await aliasRows('taxi_rank','central hub');
assert(rankRegistry.length===1 && rankRegistry[0].entity_id===central,'rank alias registry written once');
assert(rankRegistry[0].promoted_by_proposal_id===rankProposalId,'registry links proposal');
assert(Boolean(rankRegistry[0].promoted_audit_event_id),'registry links canonical audit');

const rankAudit=await audits(central,'taxi_rank.alias.add');
assert(rankAudit.length===1,'rank alias canonical audit written once');
assert(rankAudit[0].actor_subject==='adj4-approver','rank alias mutation attributed to approver');
assert(rankAudit[0].metadata.dualControl===true,'rank alias audit marked dual control');
assert(rankAudit[0].metadata.normalizedAlias==='central hub','rank alias audit retains normalized identity');

// Registry/array collision after promotion.
const promotedCollision=await call(rankAliasPath(west),{
  bearer:reviewer,key:'adj4-promoted-collision',body:proposalBody('CENTRAL HUB')
});
assert(promotedCollision.status===409 && promotedCollision.payload.error==='alias_collision','promoted alias cannot be claimed by another rank');

// Valid association alias promotion.
const assocProposal=await call(assocAliasPath(alpha),{
  bearer:reviewer,key:'adj4-assoc-create',body:proposalBody('Alpha Cabs')
});
assert(assocProposal.status===201,'association alias proposal created');
const assocApproved=await call(approvePath(assocProposal.payload.proposal.id),{
  bearer:approver,key:'adj4-assoc-approve',body:decisionBody
});
assert(assocApproved.status===200,'association alias approved');
assert((await association(alpha)).aliases.includes('Alpha Cabs'),'association alias array updated');
const assocRegistry=await aliasRows('taxi_association','alpha cabs');
assert(assocRegistry.length===1 && assocRegistry[0].entity_id===alpha,'association alias registry written');

// Same text is allowed across entity types.
const crossType=await call(rankAliasPath(airport),{
  bearer:reviewer2,key:'adj4-cross-type-create',body:proposalBody('ATA')
});
assert(crossType.status===201,'rank alias may equal association acronym because identity namespace is entity-scoped');
const crossApproved=await call(approvePath(crossType.payload.proposal.id),{
  bearer:admin,key:'adj4-cross-type-approve',body:decisionBody
});
assert(crossApproved.status===200,'cross-type alias approval succeeds');
assert((await aliasRows('taxi_rank','ata')).length===1,'rank ATA alias registered independently');

// Stale target state blocks alias approval.
const staleProposal=await call(rankAliasPath(east),{
  bearer:reviewer,key:'adj4-stale-create',body:proposalBody('East Hub')
});
assert(staleProposal.status===201,'stale alias proposal created');
await pool.query("UPDATE taxi_rank SET address='Changed after proposal',updated_at=now() WHERE id=$1::uuid",[east]);
const staleApproval=await call(approvePath(staleProposal.payload.proposal.id),{
  bearer:approver,key:'adj4-stale-approve',body:decisionBody
});
assert(staleApproval.status===409 && staleApproval.payload.error==='decision_proposal_stale_before_state','stale alias proposal approval rejected');
assert(!(await rank(east)).aliases.includes('East Hub'),'stale approval leaves aliases unchanged');
assert((await proposal(staleProposal.payload.proposal.id)).status==='proposed','stale alias proposal remains pending');

// Proposal rejection leaves canonical identity unchanged.
const rejectProposal=await call(rankAliasPath(west),{
  bearer:reviewer,key:'adj4-reject-create',body:proposalBody('Western Hub')
});
assert(rejectProposal.status===201,'alias reject-test proposal created');
const rejected=await call(rejectPath(rejectProposal.payload.proposal.id),{
  bearer:approver,key:'adj4-reject-decision',
  body:{rationale:'Independent reviewer rejects the proposed alias evidence.',evidence:{reason:'identity-not-proven'}}
});
assert(rejected.status===200 && rejected.payload.proposal.status==='rejected','alias proposal rejected');
assert(!(await rank(west)).aliases.includes('Western Hub'),'rejected alias proposal makes no canonical change');

// Concurrent same normalized alias claims on two different ranks.
const raceNorth=await call(rankAliasPath(north),{
  bearer:reviewer,key:'adj4-race-north',body:proposalBody('Shared Hub')
});
const raceSouth=await call(rankAliasPath(south),{
  bearer:reviewer2,key:'adj4-race-south',body:proposalBody('  shared   HUB ')
});
assert(raceNorth.status===201 && raceSouth.status===201,'competing alias proposals can coexist before approval');

const raceResults=await Promise.all([
  call(approvePath(raceNorth.payload.proposal.id),{bearer:approver,key:'adj4-race-approve-north',body:decisionBody}),
  call(approvePath(raceSouth.payload.proposal.id),{bearer:approver2,key:'adj4-race-approve-south',body:decisionBody})
]);
const raceStatuses=raceResults.map(x=>x.status).sort((a,b)=>a-b);
assert(raceStatuses[0]===200 && raceStatuses[1]===409,'concurrent normalized alias approvals yield one winner and one collision');
const sharedRegistry=await aliasRows('taxi_rank','shared hub');
assert(sharedRegistry.length===1,'concurrent alias race writes one registry row');
const northHas=(await rank(north)).aliases.some(x=>x.toLowerCase().replace(/\s+/g,' ')==='shared hub');
const southHas=(await rank(south)).aliases.some(x=>x.toLowerCase().replace(/\s+/g,' ')==='shared hub');
assert(Number(northHas)+Number(southHas)===1,'concurrent alias race mutates one rank only');

// Approval replay is safe.
const rankReplay=await call(approvePath(rankProposalId),{
  bearer:approver,key:'adj4-rank-approve',body:decisionBody
});
assert(rankReplay.status===200 && rankReplay.payload.replay===true,'alias approval replay is idempotent');
assert((await aliasRows('taxi_rank','central hub')).length===1,'alias replay does not duplicate registry');
assert((await audits(central,'taxi_rank.alias.add')).length===1,'alias replay does not duplicate canonical audit');

// Atomic rollback across alias array, registry, canonical audit and proposal state.
const atomicProposal=await call(assocAliasPath(gamma),{
  bearer:reviewer,key:'adj4-atomic-create',body:proposalBody('Gamma Fleet')
});
assert(atomicProposal.status===201,'atomic alias proposal created');

await pool.query("ALTER TABLE operator_audit_event ADD CONSTRAINT tn7_adj4_force_approval_audit_failure CHECK (action <> 'decision_proposal.approve') NOT VALID");
const atomicApproval=await call(approvePath(atomicProposal.payload.proposal.id),{
  bearer:approver,key:'adj4-atomic-approve',body:decisionBody
});
assert(atomicApproval.status===500,'forced alias approval audit failure returns server error');
assert(!(await association(gamma)).aliases.includes('Gamma Fleet'),'association alias update rolled back');
assert((await aliasRows('taxi_association','gamma fleet')).length===0,'alias registry insert rolled back');
assert((await audits(gamma,'taxi_association.alias.add')).length===0,'canonical alias audit rolled back');
assert((await proposal(atomicProposal.payload.proposal.id)).status==='proposed','proposal approval state rolled back');
await pool.query('ALTER TABLE operator_audit_event DROP CONSTRAINT tn7_adj4_force_approval_audit_failure');
console.log('TN7_ADJ4_ATOMIC_ALIAS_ROLLBACK_PASS');

// Database uniqueness backstop.
let uniqueBlocked=false;
try{
  const existing=(await aliasRows('taxi_rank','central hub'))[0];
  await pool.query(
    `INSERT INTO transport_entity_alias (
      entity_type,entity_id,alias,normalized_alias,promoted_by_proposal_id,promoted_audit_event_id
    ) VALUES ('taxi_rank',$1::uuid,'Central HUB','central hub',$2::uuid,$3::uuid)`,
    [west,existing.promoted_by_proposal_id,existing.promoted_audit_event_id]
  );
}catch(error){ uniqueBlocked=String(error.message).toLowerCase().includes('unique'); }
assert(uniqueBlocked,'database unique index blocks duplicate normalized alias');
console.log('TN7_ADJ4_ALIAS_UNIQUENESS_PASS');

// Audit sequence remains monotonic.
const seq=await pool.query('SELECT event_sequence FROM operator_audit_event ORDER BY event_sequence');
for(let i=1;i<seq.rows.length;i++){
  if(Number(seq.rows[i].event_sequence)<=Number(seq.rows[i-1].event_sequence)){
    throw new Error('audit_sequence_not_monotonic');
  }
}
console.log('TN7_ADJ4_AUDIT_SEQUENCE_PASS '+seq.rows.length);

const aliasCount=await pool.query('SELECT entity_type,count(*)::int AS count FROM transport_entity_alias GROUP BY entity_type ORDER BY entity_type');
console.log('TN7_ADJ4_ALIASES '+JSON.stringify(aliasCount.rows));
console.log('TN7_ADJ4_RUNTIME_PASS');

await pool.end();
await new Promise(resolve=>setTimeout(resolve,10000));
