import pg from 'pg';
const {Pool}=pg;
if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');

const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:false,max:2});
const client=await pool.connect();

try{
  await client.query('BEGIN READ ONLY');

  const result=await client.query(`
    WITH kzn_ranks AS (
      SELECT r.id,r.canonical_name,r.location,r.municipality,r.town
      FROM taxi_rank r
      WHERE r.province='KwaZulu-Natal'
        AND coalesce(to_jsonb(r)->>'merged_into_rank_id','')=''
    ),
    kzn_routes AS (
      SELECT tr.*
      FROM taxi_route tr
      LEFT JOIN taxi_association a ON a.id=tr.association_id
      LEFT JOIN taxi_rank o ON o.id=tr.origin_rank_id
      LEFT JOIN taxi_rank d ON d.id=tr.destination_rank_id
      WHERE coalesce(a.province,o.province,d.province)='KwaZulu-Natal'
    ),
    kzn_candidates AS (
      SELECT rc.*
      FROM route_candidate rc
      LEFT JOIN taxi_rank o ON o.id=rc.origin_rank_id
      LEFT JOIN taxi_rank d ON d.id=rc.destination_rank_id
      WHERE coalesce(o.province,d.province)='KwaZulu-Natal'
    )
    SELECT
      (SELECT count(*)::int FROM kzn_ranks) AS ranks,
      (SELECT count(*)::int FROM kzn_ranks WHERE location IS NOT NULL) AS mapped_ranks,
      (SELECT count(*)::int FROM kzn_ranks WHERE location IS NULL) AS location_pending,
      (SELECT count(*)::int FROM kzn_ranks r WHERE NOT EXISTS (
        SELECT 1 FROM taxi_rank_association ra WHERE ra.taxi_rank_id=r.id
      )) AS ranks_without_association,
      (SELECT count(*)::int FROM taxi_association a
       WHERE a.province='KwaZulu-Natal'
         AND coalesce(to_jsonb(a)->>'merged_into_association_id','')='') AS associations,
      (SELECT count(*)::int FROM kzn_routes) AS routes,
      (SELECT count(*)::int FROM kzn_routes WHERE association_id IS NULL) AS routes_without_association,
      (SELECT count(*)::int FROM kzn_routes WHERE origin_rank_id IS NULL OR destination_rank_id IS NULL) AS routes_with_unresolved_endpoints,
      (SELECT count(*)::int FROM kzn_candidates) AS route_candidates,
      (SELECT count(*)::int FROM kzn_candidates WHERE association_id IS NULL) AS route_candidates_without_association,
      (SELECT count(*)::int FROM rank_association_candidate rac JOIN kzn_ranks r ON r.id=rac.taxi_rank_id) AS rank_association_candidates
  `);

  const sourceRows=await client.query(`
    SELECT s.source_key,s.source_name,s.source_class,s.official,
           count(sr.*)::int AS records,
           count(sr.*) FILTER (WHERE sr.entity_type='taxi_rank')::int AS rank_records,
           count(sr.*) FILTER (WHERE sr.entity_type='taxi_route')::int AS route_records,
           count(sr.*) FILTER (WHERE sr.entity_type='taxi_association')::int AS association_records
    FROM source_registry s
    JOIN source_record sr ON sr.source_id=s.id
    LEFT JOIN taxi_rank r ON sr.entity_type='taxi_rank' AND sr.entity_id=r.id
    LEFT JOIN taxi_association a ON sr.entity_type='taxi_association' AND sr.entity_id=a.id
    LEFT JOIN taxi_route tr ON sr.entity_type='taxi_route' AND sr.entity_id=tr.id
    LEFT JOIN taxi_rank o ON tr.origin_rank_id=o.id
    LEFT JOIN taxi_rank d ON tr.destination_rank_id=d.id
    WHERE coalesce(r.province,a.province,o.province,d.province)='KwaZulu-Natal'
       OR s.source_key LIKE 'kzn-%'
    GROUP BY s.id,s.source_key,s.source_name,s.source_class,s.official
    ORDER BY records DESC,s.source_key
  `);

  const routeBuckets=await client.query(`
    WITH kzn_candidates AS (
      SELECT rc.*
      FROM route_candidate rc
      LEFT JOIN taxi_rank o ON o.id=rc.origin_rank_id
      LEFT JOIN taxi_rank d ON d.id=rc.destination_rank_id
      WHERE coalesce(o.province,d.province)='KwaZulu-Natal'
    ),
    endpoint_evidence AS (
      SELECT rc.id,
        coalesce(array_agg(DISTINCT oa.id) FILTER (WHERE oa.id IS NOT NULL),'{}'::uuid[]) origin_assoc_ids,
        coalesce(array_agg(DISTINCT da.id) FILTER (WHERE da.id IS NOT NULL),'{}'::uuid[]) destination_assoc_ids
      FROM kzn_candidates rc
      LEFT JOIN taxi_rank_association ora ON ora.taxi_rank_id=rc.origin_rank_id
      LEFT JOIN taxi_association oa ON oa.id=ora.association_id
      LEFT JOIN taxi_rank_association dra ON dra.taxi_rank_id=rc.destination_rank_id
      LEFT JOIN taxi_association da ON da.id=dra.association_id
      GROUP BY rc.id
    )
    SELECT bucket,count(*)::int
    FROM (
      SELECT rc.id,
        CASE
          WHEN rc.association_id IS NOT NULL THEN 'assigned'
          WHEN cardinality(e.origin_assoc_ids)=1
           AND cardinality(e.destination_assoc_ids)=1
           AND e.origin_assoc_ids[1]=e.destination_assoc_ids[1] THEN 'unique_shared_association'
          WHEN cardinality(e.origin_assoc_ids)>0 AND cardinality(e.destination_assoc_ids)>0 THEN 'conflicting_or_multiple'
          WHEN cardinality(e.origin_assoc_ids)>0 THEN 'origin_only'
          WHEN cardinality(e.destination_assoc_ids)>0 THEN 'destination_only'
          ELSE 'no_association_evidence'
        END AS bucket
      FROM kzn_candidates rc
      JOIN endpoint_evidence e ON e.id=rc.id
    ) x
    GROUP BY bucket
    ORDER BY bucket
  `);

  const municipalities=await client.query(`
    SELECT
      coalesce(nullif(trim(r.town),''),nullif(trim(r.municipality),''),'Unknown') municipality,
      count(*)::int ranks,
      count(*) FILTER (WHERE r.location IS NULL)::int location_pending,
      count(*) FILTER (WHERE NOT EXISTS (
        SELECT 1 FROM taxi_rank_association ra WHERE ra.taxi_rank_id=r.id
      ))::int without_association,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM rank_association_candidate rac WHERE rac.taxi_rank_id=r.id
      ))::int with_association_candidate
    FROM taxi_rank r
    WHERE r.province='KwaZulu-Natal'
      AND coalesce(to_jsonb(r)->>'merged_into_rank_id','')=''
    GROUP BY 1
    ORDER BY without_association DESC,location_pending DESC,ranks DESC,municipality
    LIMIT 50
  `);

  await client.query('ROLLBACK');

  console.log(JSON.stringify({
    event:'tn7_national_2_kzn_readonly_inventory',
    databaseWrites:false,
    summary:result.rows[0],
    routeCandidateBuckets:Object.fromEntries(routeBuckets.rows.map(r=>[r.bucket,r.count])),
    sources:sourceRows.rows,
    municipalities:municipalities.rows
  }));
}catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  console.error(JSON.stringify({event:'tn7_national_2_kzn_readonly_inventory_failed',error:String(error?.message||error)}));
  process.exitCode=1;
}finally{
  client.release();
  await pool.end();
}
