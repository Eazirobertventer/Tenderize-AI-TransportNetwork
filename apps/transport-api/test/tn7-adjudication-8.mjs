import {createHmac} from 'node:crypto';
import pg from 'pg';
const {Pool}=pg;
const api=(process.env.API_BASE||'').replace(/\/$/,'');
const secret=process.env.OPERATOR_JWT_SECRET||'';
const issuer=process.env.OPERATOR_JWT_ISSUER||'tenderize-iam';
const audience=process.env.OPERATOR_JWT_AUDIENCE||'transport-network-operator';
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:false,max:5});
if(!api || !process.env.DATABASE_URL || secret.length<32) throw new Error('runtime_configuration_missing');

function b64(v){return Buffer.from(v).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');}
function token(sub,roles){
 const now=Math.floor(Date.now()/1000),h=b64(JSON.stringify({alg:'HS256',typ:'JWT'}));
 const p=b64(JSON.stringify({iss:issuer,aud:audience,sub,roles,iat:now-5,exp:now+1200}));
 const s=createHmac('sha256',secret).update(h+'.'+p).digest('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
 return h+'.'+p+'.'+s;
}
async function call(path,{method='POST',bearer=null,key=null,body=null}={}){
 const headers={'content-type':'application/json'}; if(bearer) headers.authorization='Bearer '+bearer;if(key) headers['idempotency-key']=key;
 const r=await fetch(api+path,{method,headers,body:method==='GET'?undefined:JSON.stringify(body||{})});
 const txt=await r.text();let payload;try{payload=JSON.parse(txt)}catch{payload=txt} return {status:r.status,payload};
}
function assert(x,label){if(!x) throw new Error('FAIL '+label);console.log('PASS '+label);}
const reviewer=token('adj8-reviewer',['reviewer']), reviewer2=token('adj8-reviewer-2',['reviewer']);
const approver=token('adj8-approver',['approver']), approver2=token('adj8-approver-2',['approver']);
const A={
 validS:'aaaaaaaa-0001-4001-8001-000000000001',validD:'aaaaaaaa-0002-4002-8002-000000000002',
 regS:'aaaaaaaa-0004-4004-8004-000000000004',regD:'aaaaaaaa-0005-4005-8005-000000000005',
 routeS:'aaaaaaaa-0006-4006-8006-000000000006',routeD:'aaaaaaaa-0007-4007-8007-000000000007',
 staleS:'aaaaaaaa-0008-4008-8008-000000000008',staleD:'aaaaaaaa-0009-4009-8009-000000000009',
 concS:'aaaaaaaa-0010-4010-8010-000000000010',concD:'aaaaaaaa-0011-4011-8011-000000000011',
 atomicS:'aaaaaaaa-0012-4012-8012-000000000012',atomicD:'aaaaaaaa-0013-4013-8013-000000000013',
 aliasS:'aaaaaaaa-0014-4014-8014-000000000014',aliasD:'aaaaaaaa-0015-4015-8015-000000000015'
};
const path='/api/v1/operator/proposals/association-merges';
const body=(s,d)=>({survivorAssociationId:s,duplicateAssociationId:d,rationale:'Merge duplicate association after independent documentary review.',evidence:{gate:'TN7-ADJ8'}});

assert((await call(path,{key:'adj8-anon-1',body:body(A.validS,A.validD)})).status===401,'anonymous proposal rejected');
let x=await call(path,{bearer:reviewer,key:'adj8-same-1',body:body(A.validS,A.validS)});
assert(x.status===409 && x.payload.error==='association_merge_same_entity','same association rejected');
x=await call(path,{bearer:reviewer,key:'adj8-reg-1',body:body(A.regS,A.regD)});
assert(x.status===409 && x.payload.error==='association_merge_registration_conflict','conflicting registration identifiers rejected');
x=await call(path,{bearer:reviewer,key:'adj8-alias-1',body:body(A.aliasS,A.aliasD)});
assert(x.status===409 && x.payload.error==='association_merge_identity_collision','third-party identity collision rejected');
x=await call(path,{bearer:reviewer,key:'adj8-route-1',body:body(A.routeS,A.routeD)});
assert(x.status===409 && x.payload.error==='association_merge_route_duplicate_conflict','projected duplicate canonical route rejected');

const created=await call(path,{bearer:reviewer,key:'adj8-valid-create',body:body(A.validS,A.validD)});
assert(created.status===201,'valid association merge proposal created');
const pid=created.payload.proposal.id;
assert((await call('/api/v1/operator/proposals/'+pid+'/approve',{bearer:reviewer,key:'adj8-self',body:{rationale:'Self approval must fail.',evidence:{proof:true}}})).status===403,'reviewer/self approval rejected');
const approved=await call('/api/v1/operator/proposals/'+pid+'/approve',{bearer:approver,key:'adj8-valid-approve',body:{rationale:'Independent approver verified association identity graph.',evidence:{proof:true}}});
assert(approved.status===200 && approved.payload.replay===false,'independent approval executes merge');

const dup=(await pool.query(`SELECT canonical_name,merged_into_association_id::text,merge_proposal_id::text,merge_audit_event_id::text FROM taxi_association WHERE id=$1`,[A.validD])).rows[0];
const surv=(await pool.query(`SELECT aliases FROM taxi_association WHERE id=$1`,[A.validS])).rows[0];
assert(dup.merged_into_association_id===A.validS && dup.merge_proposal_id===pid && dup.merge_audit_event_id,'duplicate becomes lineage-linked tombstone');
assert(surv.aliases.includes('Old Alpha Taxi Association') && surv.aliases.includes('OLD') && surv.aliases.includes('Old Alpha Legacy'),'duplicate identity transfers as safe aliases');
const drel=(await pool.query('SELECT count(*)::int c FROM taxi_rank_association WHERE association_id=$1',[A.validD])).rows[0].c;
const srel=(await pool.query('SELECT count(*)::int c FROM taxi_rank_association WHERE association_id=$1',[A.validS])).rows[0].c;
assert(drel===0 && srel===2,'relationship overlap collapses and non-overlap redirects');
assert((await pool.query('SELECT association_id::text FROM taxi_route WHERE id=$1',['bbbbbbbb-0001-4001-8001-000000000001'])).rows[0].association_id===A.validS,'canonical route redirects');
assert((await pool.query('SELECT entity_id::text FROM data_issue WHERE id=$1',['cccccccc-0001-4001-8001-000000000001'])).rows[0].entity_id===A.validS,'active issue redirects');
assert((await pool.query('SELECT entity_id::text FROM data_issue WHERE id=$1',['cccccccc-0002-4002-8002-000000000002'])).rows[0].entity_id===A.validD,'resolved issue remains historical on tombstone');
assert((await pool.query('SELECT entity_id::text FROM source_record WHERE id=$1',['dddddddd-0001-4001-8001-000000000001'])).rows[0].entity_id===A.validD,'source evidence remains on tombstone');
assert((await pool.query('SELECT count(*)::int c FROM taxi_association_merge_lineage WHERE duplicate_association_id=$1',[A.validD])).rows[0].c===1,'durable merge lineage written');
assert((await pool.query("SELECT count(*)::int c FROM operator_audit_event WHERE action='taxi_association.merge' AND entity_id=$1",[A.validS])).rows[0].c===1,'canonical merge audit written once');

const list=await call('/api/v1/associations',{method:'GET'});
assert(list.status===200 && !list.payload.items.some(a=>a.id===A.validD),'operational association list hides tombstone');
assert((await call('/api/v1/associations/'+A.validD,{method:'GET'})).status===404,'association detail hides tombstone');
const replay=await call('/api/v1/operator/proposals/'+pid+'/approve',{bearer:approver,key:'adj8-valid-approve',body:{rationale:'Independent approver verified association identity graph.',evidence:{proof:true}}});
assert(replay.status===200 && replay.payload.replay===true,'approval replay idempotent');
assert((await pool.query("SELECT count(*)::int c FROM operator_audit_event WHERE action='taxi_association.merge' AND entity_id=$1",[A.validS])).rows[0].c===1,'replay does not duplicate canonical audit');

let blocked=false;try{await pool.query("UPDATE taxi_association SET canonical_name='Resurrected' WHERE id=$1",[A.validD]);}catch(e){blocked=String(e.message).includes('immutable');}
assert(blocked,'tombstone update blocked');
blocked=false;try{await pool.query('DELETE FROM taxi_association WHERE id=$1',[A.validD]);}catch(e){blocked=String(e.message).includes('immutable');}
assert(blocked,'tombstone delete blocked');

// stale graph
const stale=await call(path,{bearer:reviewer,key:'adj8-stale-create',body:body(A.staleS,A.staleD)});
assert(stale.status===201,'stale proposal created');
await pool.query("UPDATE data_issue SET summary='changed after proposal' WHERE id='cccccccc-0003-4003-8003-000000000003'");
const staleApprove=await call('/api/v1/operator/proposals/'+stale.payload.proposal.id+'/approve',{bearer:approver,key:'adj8-stale-approve',body:{rationale:'Attempt stale approval.',evidence:{proof:true}}});
assert(staleApprove.status===409 && staleApprove.payload.error==='decision_proposal_stale_before_state','changed graph rejects stale approval');

// concurrent
const concurrent=await Promise.all([
 call(path,{bearer:reviewer,key:'adj8-concurrent-1',body:body(A.concS,A.concD)}),
 call(path,{bearer:reviewer2,key:'adj8-concurrent-2',body:body(A.concS,A.concD)})
]);
assert(concurrent.filter(v=>v.status===201).length===1 && concurrent.filter(v=>v.status===409).length===1,'concurrent proposals serialize to one winner');
const winner=concurrent.find(v=>v.status===201);
assert((await call('/api/v1/operator/proposals/'+winner.payload.proposal.id+'/approve',{bearer:approver2,key:'adj8-concurrent-approve',body:{rationale:'Approve serialized proposal.',evidence:{proof:true}}})).status===200,'serialized winner independently approved');

// atomic rollback
const fresh=await call(path,{bearer:reviewer2,key:'adj8-atomic-create',body:body(A.atomicS,A.atomicD)});
assert(fresh.status===201,'atomic rollback proposal created');
await pool.query("ALTER TABLE operator_audit_event ADD CONSTRAINT tn7_adj8_force_approval_failure CHECK (action <> 'decision_proposal.approve') NOT VALID");
const atomic=await call('/api/v1/operator/proposals/'+fresh.payload.proposal.id+'/approve',{bearer:approver2,key:'adj8-atomic-approve',body:{rationale:'Force final audit failure.',evidence:{proof:true}}});
assert(atomic.status===500,'forced final audit failure returns 500');
assert((await pool.query('SELECT merged_into_association_id FROM taxi_association WHERE id=$1',[A.atomicD])).rows[0].merged_into_association_id===null,'tombstone rolls back');
assert((await pool.query('SELECT count(*)::int c FROM taxi_rank_association WHERE association_id=$1',[A.atomicD])).rows[0].c===1,'relationship redirect rolls back');
assert((await pool.query('SELECT association_id::text FROM taxi_route WHERE id=$1',['bbbbbbbb-0004-4004-8004-000000000004'])).rows[0].association_id===A.atomicD,'route redirect rolls back');
assert((await pool.query('SELECT entity_id::text FROM data_issue WHERE id=$1',['cccccccc-0004-4004-8004-000000000004'])).rows[0].entity_id===A.atomicD,'issue redirect rolls back');
assert((await pool.query('SELECT count(*)::int c FROM taxi_association_merge_lineage WHERE duplicate_association_id=$1',[A.atomicD])).rows[0].c===0,'lineage rolls back');
assert((await pool.query("SELECT count(*)::int c FROM operator_audit_event WHERE action='taxi_association.merge' AND entity_id=$1",[A.atomicS])).rows[0].c===0,'canonical audit rolls back');
await pool.query('ALTER TABLE operator_audit_event DROP CONSTRAINT tn7_adj8_force_approval_failure');
console.log('TN7_ADJ8_ATOMIC_MERGE_ROLLBACK_PASS');

const seq=(await pool.query('SELECT event_sequence FROM operator_audit_event ORDER BY event_sequence')).rows;
for(let i=1;i<seq.length;i++) if(Number(seq[i].event_sequence)<=Number(seq[i-1].event_sequence)) throw new Error('audit_sequence_not_monotonic');
console.log('TN7_ADJ8_AUDIT_SEQUENCE_PASS '+seq.length);
console.log('TN7_ADJ8_RUNTIME_PASS');
await pool.end();
await new Promise(r=>setTimeout(r,5000));
