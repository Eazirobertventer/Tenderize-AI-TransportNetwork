import { createHmac } from 'node:crypto';
import pg from 'pg';

const {Pool}=pg;
const api=(process.env.API_BASE||'').replace(/\/$/,'');
const secret=process.env.OPERATOR_JWT_SECRET||'';
const issuer=process.env.OPERATOR_JWT_ISSUER||'';
const audience=process.env.OPERATOR_JWT_AUDIENCE||'';
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:false,max:5});

if(!api || !process.env.DATABASE_URL || secret.length<32) throw new Error('runtime_configuration_missing');

function b64(v){return Buffer.from(v).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');}
function token(sub,roles){
  const now=Math.floor(Date.now()/1000);
  const h=b64(JSON.stringify({alg:'HS256',typ:'JWT'}));
  const p=b64(JSON.stringify({iss:issuer,aud:audience,sub,roles,iat:now-5,exp:now+1200}));
  const s=createHmac('sha256',secret).update(h+'.'+p).digest('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  return h+'.'+p+'.'+s;
}
async function call(path,{method='POST',bearer=null,key=null,body=null}={}){
  const headers={'content-type':'application/json'};
  if(bearer) headers.authorization='Bearer '+bearer;
  if(key) headers['idempotency-key']=key;
  const r=await fetch(api+path,{method,headers,body:method==='GET'?undefined:JSON.stringify(body||{})});
  const text=await r.text(); let payload;
  try{payload=JSON.parse(text)}catch{payload=text}
  return {status:r.status,payload};
}
function assert(ok,label){if(!ok) throw new Error('FAIL '+label); console.log('PASS '+label);}
async function rank(id){
  const r=await pool.query(`SELECT id::text,canonical_name,aliases,
    (to_jsonb(taxi_rank)->>'merged_into_rank_id') AS merged_into_rank_id,
    (to_jsonb(taxi_rank)->>'merge_proposal_id') AS merge_proposal_id,
    (to_jsonb(taxi_rank)->>'merge_audit_event_id') AS merge_audit_event_id
    FROM taxi_rank WHERE id=$1::uuid`,[id]);
  return r.rows[0]||null;
}
async function rels(id){
  return (await pool.query(`SELECT relationship_id::text,association_id::text FROM taxi_rank_association
    WHERE taxi_rank_id=$1::uuid ORDER BY association_id`,[id])).rows;
}
async function routes(id){
  return (await pool.query(`SELECT id::text,origin_rank_id::text,destination_rank_id::text FROM taxi_route
    WHERE origin_rank_id=$1::uuid OR destination_rank_id=$1::uuid ORDER BY id`,[id])).rows;
}
async function issues(id){
  return (await pool.query(`SELECT id::text FROM data_issue WHERE entity_type='taxi_rank' AND entity_id=$1::uuid ORDER BY id`,[id])).rows;
}
async function proposal(id){return (await pool.query('SELECT id::text,status,approved_audit_event_id::text FROM operator_decision_proposal WHERE id=$1::uuid',[id])).rows[0]||null;}
async function lineage(dup){return (await pool.query('SELECT id::text,survivor_rank_id::text,duplicate_rank_id::text,proposal_id::text,merge_audit_event_id::text,redirect_counts FROM taxi_rank_merge_lineage WHERE duplicate_rank_id=$1::uuid',[dup])).rows[0]||null;}
async function auditCount(action,survivor){return (await pool.query('SELECT count(*)::int AS count FROM operator_audit_event WHERE action=$1 AND entity_id=$2::uuid',[action,survivor])).rows[0].count;}

const reviewer=token('adj7-reviewer',['reviewer']);
const reviewer2=token('adj7-reviewer-2',['reviewer']);
const approver=token('adj7-approver',['approver']);
const approver2=token('adj7-approver-2',['approver']);

const survivor='90909090-9090-4090-8090-909090909090';
const duplicate='91919191-9191-4191-8191-919191919191';
const peer='92929292-9292-4292-8292-929292929292';
const googleS='93939393-9393-4393-8393-939393939393';
const googleD='94949494-9494-4494-8494-949494949494';
const aliasS='95959595-9595-4595-8595-959595959595';
const aliasD='96969696-9696-4696-8696-969696969696';
const loopS='98989898-9898-4898-8898-989898989898';
const loopD='99999998-9998-4998-8998-999999999998';
const atomicS='a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';
const atomicD='a2a2a2a2-a2a2-42a2-82a2-a2a2a2a2a2a2';
const concS='a3a3a3a3-a3a3-43a3-83a3-a3a3a3a3a3a3';
const concD='a4a4a4a4-a4a4-44a4-84a4-a4a4a4a4a4a4';

const path='/api/v1/operator/proposals/rank-merges';
const body=(s,d)=>({survivorRankId:s,duplicateRankId:d,rationale:'Merge duplicate taxi rank after independent evidence review.',evidence:{review:'tn7-adj7-proof'}});

assert((await call(path,{key:'adj7-anon',body:body(survivor,duplicate)})).status===401,'anonymous merge proposal rejected');
assert((await call(path,{bearer:reviewer,key:'adj7-same',body:body(survivor,survivor)})).status===409,'same rank cannot merge into itself');

const g=await call(path,{bearer:reviewer,key:'adj7-google',body:body(googleS,googleD)});
assert(g.status===409 && g.payload.error==='rank_merge_google_place_conflict','conflicting Google Place identities block merge');

const ac=await call(path,{bearer:reviewer,key:'adj7-alias',body:body(aliasS,aliasD)});
assert(ac.status===409 && ac.payload.error==='rank_merge_alias_collision','third-party alias collision blocks merge');

const sl=await call(path,{bearer:reviewer,key:'adj7-loop',body:body(loopS,loopD)});
assert(sl.status===409 && sl.payload.error==='rank_merge_route_self_loop_conflict','route self-loop projection blocks merge');

const created=await call(path,{bearer:reviewer,key:'adj7-valid-create',body:body(survivor,duplicate)});
assert(created.status===201,'valid merge proposal created');
const pid=created.payload.proposal.id;

assert((await call('/api/v1/operator/proposals/'+pid+'/approve',{bearer:reviewer,key:'adj7-reviewer-approve',body:{rationale:'Reviewer cannot self-approve merge.',evidence:{proof:true}}})).status===403,'reviewer cannot approve merge');

const approved=await call('/api/v1/operator/proposals/'+pid+'/approve',{bearer:approver,key:'adj7-valid-approve',body:{rationale:'Independent approver verified merge graph and evidence.',evidence:{review:'second-person'}}});
assert(approved.status===200 && approved.payload.replay===false,'independent approver executes merge');

const s=await rank(survivor); const d=await rank(duplicate);
assert(d.merged_into_rank_id===survivor,'duplicate becomes tombstone pointing to survivor');
assert(d.merge_proposal_id===pid && Boolean(d.merge_audit_event_id),'tombstone links proposal and merge audit');
assert(s.aliases.includes('Old Central Taxi Rank') && s.aliases.includes('Old Central') && s.aliases.includes('OCR'),'duplicate canonical name and aliases transfer to survivor');

const sr=await rels(survivor); const dr=await rels(duplicate);
assert(sr.map(x=>x.association_id).includes('21212121-2121-4212-8212-212121212121') && sr.map(x=>x.association_id).includes('23232323-2323-4232-8232-232323232323'),'overlap collapsed and non-overlap association redirected');
assert(dr.length===0,'duplicate has no active canonical association edges');

const survivorRoutes=await routes(survivor); const duplicateRoutes=await routes(duplicate);
assert(survivorRoutes.some(x=>x.id==='b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1' && x.origin_rank_id===survivor),'canonical route endpoint redirects to survivor');
assert(duplicateRoutes.length===0,'duplicate has no canonical route edges');

assert((await issues(survivor)).some(x=>x.id==='c4c4c4c4-c4c4-44c4-84c4-c4c4c4c4c4c4'),'active rank issue redirects to survivor');
assert((await issues(duplicate)).length===0,'duplicate has no active data issues');

const sourceCandidate=(await pool.query('SELECT taxi_rank_id::text FROM rank_association_candidate WHERE id=$1::uuid',['c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1'])).rows[0];
const sourceRecord=(await pool.query('SELECT entity_id::text FROM source_record WHERE id=$1::uuid',['c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3'])).rows[0];
assert(sourceCandidate.taxi_rank_id===duplicate && sourceRecord.entity_id===duplicate,'source evidence remains anchored to tombstone UUID');

const lin=await lineage(duplicate);
assert(Boolean(lin) && lin.survivor_rank_id===survivor && lin.proposal_id===pid,'durable merge lineage links survivor duplicate and proposal');
assert(Number(lin.redirect_counts.relationshipsRedirected)===1 && Number(lin.redirect_counts.overlappingRelationshipsCollapsed)===1,'merge lineage records relationship redirect counts');
assert((await auditCount('taxi_rank.merge',survivor))===1,'canonical merge audit written once');

const map=await call('/api/v1/ranks?province=Gauteng',{method:'GET'});
assert(map.status===200 && !map.payload.features.some(f=>f.properties?.id===duplicate),'operational rank map hides tombstone');
const detail=await call('/api/v1/ranks/'+duplicate,{method:'GET'});
assert(detail.status===404,'active rank detail hides tombstone');

const replay=await call('/api/v1/operator/proposals/'+pid+'/approve',{bearer:approver,key:'adj7-valid-approve',body:{rationale:'Independent approver verified merge graph and evidence.',evidence:{review:'second-person'}}});
assert(replay.status===200 && replay.payload.replay===true,'merge approval replay is idempotent');
assert((await auditCount('taxi_rank.merge',survivor))===1,'merge replay does not duplicate canonical audit');

let tombstoneUpdateBlocked=false;
try{await pool.query("UPDATE taxi_rank SET canonical_name='Resurrected Rank' WHERE id=$1::uuid",[duplicate]);}
catch(e){tombstoneUpdateBlocked=String(e.message).includes('immutable');}
assert(tombstoneUpdateBlocked,'merged tombstone cannot be updated');

let tombstoneDeleteBlocked=false;
try{await pool.query('DELETE FROM taxi_rank WHERE id=$1::uuid',[duplicate]);}
catch(e){tombstoneDeleteBlocked=String(e.message).includes('immutable');}
assert(tombstoneDeleteBlocked,'merged tombstone cannot be deleted');

// Stale proposal: mutate active issue set after proposal.
const stale=await call(path,{bearer:reviewer,key:'adj7-stale-create',body:body(atomicS,atomicD)});
assert(stale.status===201,'stale merge proposal created');
await pool.query("UPDATE data_issue SET summary='Changed after proposal' WHERE id=$1::uuid",['c5c5c5c5-c5c5-45c5-85c5-c5c5c5c5c5c5']);
const staleApprove=await call('/api/v1/operator/proposals/'+stale.payload.proposal.id+'/approve',{bearer:approver,key:'adj7-stale-approve',body:{rationale:'Attempt stale merge approval after graph changed.',evidence:{proof:true}}});
assert(staleApprove.status===409 && staleApprove.payload.error==='decision_proposal_stale_before_state','changed merge graph makes proposal stale');
assert((await rank(atomicD)).merged_into_rank_id===null,'stale merge leaves duplicate active');
await call('/api/v1/operator/proposals/'+stale.payload.proposal.id+'/reject',{bearer:approver,key:'adj7-stale-reject',body:{rationale:'Reject stale merge proposal after graph changed.',evidence:{proof:true}}});

// Concurrent proposal creation for same pair: advisory lock + pending proposal yields one winner.
const concurrent=await Promise.all([
  call(path,{bearer:reviewer,key:'adj7-conc-create-1',body:body(concS,concD)}),
  call(path,{bearer:reviewer2,key:'adj7-conc-create-2',body:body(concS,concD)})
]);
const concStatuses=concurrent.map(x=>x.status).sort((a,b)=>a-b);
assert(concStatuses[0]===201 && concStatuses[1]===409,'concurrent merge proposals yield one pending proposal');
const concWinner=concurrent.find(x=>x.status===201);
const concApproved=await call('/api/v1/operator/proposals/'+concWinner.payload.proposal.id+'/approve',{bearer:approver2,key:'adj7-conc-approve',body:{rationale:'Approve serialized concurrent merge proposal.',evidence:{proof:true}}});
assert(concApproved.status===200,'serialized concurrent merge proposal can be approved');
assert((await rank(concD)).merged_into_rank_id===concS,'concurrent duplicate becomes tombstone once');

// Atomic rollback after fresh proposal on atomic pair.
const fresh=await call(path,{bearer:reviewer2,key:'adj7-atomic-create',body:body(atomicS,atomicD)});
assert(fresh.status===201,'fresh atomic merge proposal created');
await pool.query("ALTER TABLE operator_audit_event ADD CONSTRAINT tn7_adj7_force_approval_failure CHECK (action <> 'decision_proposal.approve') NOT VALID");
const atomic=await call('/api/v1/operator/proposals/'+fresh.payload.proposal.id+'/approve',{bearer:approver2,key:'adj7-atomic-approve',body:{rationale:'Force final approval audit failure for merge rollback proof.',evidence:{proof:true}}});
assert(atomic.status===500,'forced merge approval audit failure returns server error');
assert((await rank(atomicD)).merged_into_rank_id===null,'tombstone marking rolls back');
assert((await rels(atomicD)).length===1,'relationship redirect rolls back');
assert((await routes(atomicD)).some(x=>x.id==='b3b3b3b3-b3b3-43b3-83b3-b3b3b3b3b3b3'),'route redirect rolls back');
assert((await issues(atomicD)).some(x=>x.id==='c5c5c5c5-c5c5-45c5-85c5-c5c5c5c5c5c5'),'data issue redirect rolls back');
assert((await lineage(atomicD))===null,'merge lineage insert rolls back');
assert((await auditCount('taxi_rank.merge',atomicS))===0,'canonical merge audit rolls back');
assert((await proposal(fresh.payload.proposal.id)).status==='proposed','proposal approval state rolls back');
await pool.query('ALTER TABLE operator_audit_event DROP CONSTRAINT tn7_adj7_force_approval_failure');
console.log('TN7_ADJ7_ATOMIC_MERGE_ROLLBACK_PASS');

const seq=await pool.query('SELECT event_sequence FROM operator_audit_event ORDER BY event_sequence');
for(let i=1;i<seq.rows.length;i++) if(Number(seq.rows[i].event_sequence)<=Number(seq.rows[i-1].event_sequence)) throw new Error('audit_sequence_not_monotonic');
console.log('TN7_ADJ7_AUDIT_SEQUENCE_PASS '+seq.rows.length);

const active=await call('/api/v1/network-inventory',{method:'GET'});
console.log('TN7_ADJ7_ACTIVE_COUNTS '+JSON.stringify({ranks:active.payload.ranks,routes:active.payload.routes}));
console.log('TN7_ADJ7_RUNTIME_PASS');

await pool.end();
await new Promise(r=>setTimeout(r,10000));
