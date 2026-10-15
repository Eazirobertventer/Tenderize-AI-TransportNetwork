import pg from 'pg';
const {Pool}=pg;
if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:false,max:1});
const client=await pool.connect();
try{
 const inventory=(await client.query(`
 SELECT
  (SELECT count(*)::int FROM taxi_rank) AS ranks,
  (SELECT count(*)::int FROM taxi_association) AS associations,
  (SELECT count(*)::int FROM taxi_route) AS routes,
  (SELECT count(*)::int FROM rank_association_candidate) AS rank_association_candidates,
  (SELECT count(*)::int FROM route_candidate) AS route_candidates
 `)).rows[0];

 const proposals=(await client.query(`
 SELECT id::text,status,decision_actor_subject,decision_actor_role,
        decision_idempotency_key,approved_audit_event_id::text,
        intended_change->>'canonicalName' AS canonical_name
 FROM operator_decision_proposal
 WHERE proposer_subject='tn7-national15-controlled-batch'
   AND action='taxi_association.create'
 ORDER BY proposed_at,id
 `)).rows;

 const associations=(await client.query(`
 SELECT id::text,canonical_name,province,verification_status::text
 FROM taxi_association
 WHERE canonical_name IN (
   'CHATSWORTH MINIBUS ASSOCIATION',
   'THUTHUKANI TAXI ASSOCIATION (HARDING)',
   'MIDLANDS TAXI ASSOCIATION',
   'MBAZWANA TAXI ASSOCIATION',
   'BAMBANANI TAXI ASSOCIATION(KZN)',
   'NGWELEZANE TAXI ASSOCIATION',
   'LINDELANI TAXI ASSOCIATION',
   'GLUCKSTADT TAXI OWNERS ASSOCIATION',
   'MLABA & MKHIZWANE TAXI ASSOCIATION'
 )
 ORDER BY canonical_name
 `)).rows;

 const sourceRecords=(await client.query(`
 SELECT sr.id::text,sr.entity_id::text,sr.external_record_id,sr.checksum,s.source_key
 FROM source_record sr
 JOIN source_registry s ON s.id=sr.source_id
 JOIN taxi_association a ON a.id=sr.entity_id
 WHERE sr.entity_type='taxi_association'
   AND a.canonical_name IN (
     'CHATSWORTH MINIBUS ASSOCIATION',
     'THUTHUKANI TAXI ASSOCIATION (HARDING)',
     'MIDLANDS TAXI ASSOCIATION',
     'MBAZWANA TAXI ASSOCIATION',
     'BAMBANANI TAXI ASSOCIATION(KZN)',
     'NGWELEZANE TAXI ASSOCIATION',
     'LINDELANI TAXI ASSOCIATION',
     'GLUCKSTADT TAXI OWNERS ASSOCIATION',
     'MLABA & MKHIZWANE TAXI ASSOCIATION'
   )
 ORDER BY sr.entity_id,s.source_key
 `)).rows;

 const perAssociation=Object.fromEntries(associations.map(a=>[
   a.id,sourceRecords.filter(r=>r.entity_id===a.id).length
 ]));

 const placeholder=(await client.query(`
 SELECT id::text FROM taxi_association
 WHERE normalize_transport_identity_name(canonical_name)=normalize_transport_identity_name('NOT AVAILABLE')
 `)).rows;

 const canonicalAudits=(await client.query(`
 SELECT count(*)::int AS count FROM operator_audit_event
 WHERE action='taxi_association.create'
   AND actor_subject='railway-user:d0d5e9e9-e6f9-4431-a4b3-c140596faa88'
 `)).rows[0].count;

 const approvalAudits=(await client.query(`
 SELECT count(*)::int AS count FROM operator_audit_event
 WHERE action='decision_proposal.approve'
   AND actor_subject='railway-user:d0d5e9e9-e6f9-4431-a4b3-c140596faa88'
 `)).rows[0].count;

 console.log(JSON.stringify({
   event:'TN7_NATIONAL_17_FINAL_DB_PROOF',
   inventory,
   counts:{
     proposals:proposals.length,
     approved:proposals.filter(x=>x.status==='approved').length,
     correctApprover:proposals.filter(x=>x.decision_actor_subject==='railway-user:d0d5e9e9-e6f9-4431-a4b3-c140596faa88'&&x.decision_actor_role==='approver').length,
     approvedAuditLinked:proposals.filter(x=>x.approved_audit_event_id).length,
     canonicalAssociations:associations.length,
     sourceRecords:sourceRecords.length,
     twoSourceRecordsEach:Object.values(perAssociation).every(n=>n===2),
     placeholderCreated:placeholder.length,
     canonicalAuditEvents:canonicalAudits,
     approvalAuditEvents:approvalAudits
   },
   associations,
   sourceRecordSourceKeys:[...new Set(sourceRecords.map(x=>x.source_key))],
   perAssociation
 }));
}finally{
 client.release();
 await pool.end();
}
