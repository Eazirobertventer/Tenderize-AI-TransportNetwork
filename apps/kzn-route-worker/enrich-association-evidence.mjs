import pg from 'pg';

const {Pool}=pg;
if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const sourceKey='kzn-dot-taxi-routes-2026';
const dryRun=process.env.ROUTE_ASSOCIATION_EVIDENCE_DRY_RUN==='true';
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2,ssl:false});
const client=await pool.connect();

try{
  const rows=await client.query(
    `WITH candidates AS (
       SELECT rc.id,rc.external_record_id,rc.route_code,rc.origin_rank_id,rc.destination_rank_id,
              o.canonical_name origin_name,d.canonical_name destination_name
       FROM route_candidate rc
       JOIN source_registry s ON s.id=rc.source_id
       JOIN taxi_rank o ON o.id=rc.origin_rank_id
       JOIN taxi_rank d ON d.id=rc.destination_rank_id
       WHERE s.source_key=$1
     ),
     origin_assoc AS (
       SELECT c.id route_candidate_id,
              array_agg(DISTINCT a.canonical_name ORDER BY a.canonical_name) names
       FROM candidates c
       JOIN taxi_rank_association tra ON tra.taxi_rank_id=c.origin_rank_id
       JOIN taxi_association a ON a.id=tra.association_id
       GROUP BY c.id
     ),
     destination_assoc AS (
       SELECT c.id route_candidate_id,
              array_agg(DISTINCT a.canonical_name ORDER BY a.canonical_name) names
       FROM candidates c
       JOIN taxi_rank_association tra ON tra.taxi_rank_id=c.destination_rank_id
       JOIN taxi_association a ON a.id=tra.association_id
       GROUP BY c.id
     )
     SELECT c.*,
            coalesce(oa.names,'{}'::text[]) origin_associations,
            coalesce(da.names,'{}'::text[]) destination_associations
     FROM candidates c
     LEFT JOIN origin_assoc oa ON oa.route_candidate_id=c.id
     LEFT JOIN destination_assoc da ON da.route_candidate_id=c.id
     WHERE coalesce(cardinality(oa.names),0)>0
        OR coalesce(cardinality(da.names),0)>0
     ORDER BY c.external_record_id`,
    [sourceKey]
  );

  const enriched=rows.rows.map(row=>({
    id:row.id,
    externalRecordId:row.external_record_id,
    routeCode:row.route_code,
    origin:row.origin_name,
    destination:row.destination_name,
    originAssociations:row.origin_associations,
    destinationAssociations:row.destination_associations,
    associationAssignment:'not_assigned_endpoint_evidence_only'
  }));

  if(dryRun){
    console.log(JSON.stringify({
      event:'tn6_l_route_association_evidence_dry_run',
      sourceKey,
      databaseWrites:false,
      eligible:enriched.length,
      samples:enriched.slice(0,30)
    }));
  }else{
    await client.query('BEGIN');

    let updated=0;
    for(const row of enriched){
      const evidence={
        originAssociations:row.originAssociations,
        destinationAssociations:row.destinationAssociations,
        assignment:'not_assigned_endpoint_evidence_only',
        policy:'one_sided_endpoint_association_does_not_establish_route_ownership'
      };

      const write=await client.query(
        `UPDATE route_candidate
         SET provenance =
           coalesce(provenance,'{}'::jsonb)
           || jsonb_build_object(
                'endpointAssociationEvidence',$2::jsonb,
                'associationAssignment','not_assigned_endpoint_evidence_only'
              ),
             last_seen_at=now()
         WHERE id=$1::uuid
           AND association_id IS NULL
         RETURNING id`,
        [row.id,JSON.stringify(evidence)]
      );
      updated+=write.rowCount;
    }

    await client.query('COMMIT');

    const proof=await client.query(
      `SELECT
         count(*) FILTER (
           WHERE provenance ? 'endpointAssociationEvidence'
         )::int AS evidence_enriched,
         count(*) FILTER (
           WHERE association_id IS NOT NULL
         )::int AS association_assigned
       FROM route_candidate rc
       JOIN source_registry s ON s.id=rc.source_id
       WHERE s.source_key=$1`,
      [sourceKey]
    );

    console.log(JSON.stringify({
      event:'tn6_l_route_association_evidence_complete',
      sourceKey,
      eligible:enriched.length,
      updated,
      associationWrites:false,
      canonicalRouteWrites:false,
      database:proof.rows[0]
    }));
  }
}catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  console.error(JSON.stringify({
    event:'tn6_l_route_association_evidence_failed',
    error:String(error?.message||error)
  }));
  process.exitCode=1;
}finally{
  client.release();
  await pool.end();
}
