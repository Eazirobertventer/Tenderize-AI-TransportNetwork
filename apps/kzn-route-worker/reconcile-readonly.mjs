import pg from 'pg';

const { Pool }=pg;
if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const sourceKey='kzn-dot-taxi-routes-2026';
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2,ssl:false});
const client=await pool.connect();

try{
  await client.query('BEGIN READ ONLY');

  const source=await client.query(
    'SELECT id FROM source_registry WHERE source_key=$1',
    [sourceKey]
  );
  if(source.rows.length!==1) throw new Error('KZN source not found');
  const sourceId=source.rows[0].id;

  const result=await client.query(
    `WITH routes AS (
       SELECT
         srg.id,
         srg.external_record_id,
         srg.route_code,
         srg.municipality,
         srg.district,
         srg.category,
         srg.map_title,
         CASE
           WHEN GeometryType(ST_LineMerge(srg.geometry))='LINESTRING'
             THEN ST_StartPoint(ST_LineMerge(srg.geometry))
           ELSE ST_StartPoint(ST_GeometryN(srg.geometry,1))
         END AS start_pt,
         CASE
           WHEN GeometryType(ST_LineMerge(srg.geometry))='LINESTRING'
             THEN ST_EndPoint(ST_LineMerge(srg.geometry))
           ELSE ST_EndPoint(ST_GeometryN(srg.geometry,ST_NumGeometries(srg.geometry)))
         END AS end_pt
       FROM source_route_geometry srg
       WHERE srg.source_id=$1
         AND srg.geometry IS NOT NULL
     ),
     start_candidates AS (
       SELECT
         r.id AS route_id,
         tr.id AS rank_id,
         tr.canonical_name,
         ST_DistanceSphere(r.start_pt,tr.location) AS distance_m,
         count(*) OVER (PARTITION BY r.id) AS within_100_count
       FROM routes r
       JOIN taxi_rank tr
         ON tr.province='KwaZulu-Natal'
        AND tr.location IS NOT NULL
        AND ST_DWithin(r.start_pt::geography,tr.location::geography,100)
     ),
     end_candidates AS (
       SELECT
         r.id AS route_id,
         tr.id AS rank_id,
         tr.canonical_name,
         ST_DistanceSphere(r.end_pt,tr.location) AS distance_m,
         count(*) OVER (PARTITION BY r.id) AS within_100_count
       FROM routes r
       JOIN taxi_rank tr
         ON tr.province='KwaZulu-Natal'
        AND tr.location IS NOT NULL
        AND ST_DWithin(r.end_pt::geography,tr.location::geography,100)
     ),
     best_start AS (
       SELECT DISTINCT ON (route_id)
         route_id,rank_id,canonical_name,distance_m,within_100_count
       FROM start_candidates
       ORDER BY route_id,distance_m,rank_id
     ),
     best_end AS (
       SELECT DISTINCT ON (route_id)
         route_id,rank_id,canonical_name,distance_m,within_100_count
       FROM end_candidates
       ORDER BY route_id,distance_m,rank_id
     ),
     classified AS (
       SELECT
         r.id,
         r.external_record_id,
         r.route_code,
         r.municipality,
         r.district,
         r.category,
         r.map_title,
         bs.rank_id AS start_rank_id,
         bs.canonical_name AS start_rank_name,
         bs.distance_m AS start_distance_m,
         coalesce(bs.within_100_count,0) AS start_within_100,
         be.rank_id AS end_rank_id,
         be.canonical_name AS end_rank_name,
         be.distance_m AS end_distance_m,
         coalesce(be.within_100_count,0) AS end_within_100,
         CASE
           WHEN bs.rank_id IS NOT NULL
            AND be.rank_id IS NOT NULL
            AND bs.rank_id<>be.rank_id
            AND bs.distance_m<=50
            AND be.distance_m<=50
            AND bs.within_100_count=1
            AND be.within_100_count=1
             THEN 'EXACT_ENDPOINT_PAIR'
           WHEN bs.rank_id IS NOT NULL
            AND be.rank_id IS NOT NULL
            AND bs.rank_id<>be.rank_id
            AND bs.distance_m<=100
            AND be.distance_m<=100
             THEN 'REVIEW_ENDPOINT_PAIR'
           WHEN bs.rank_id IS NOT NULL OR be.rank_id IS NOT NULL
             THEN 'PARTIAL_ENDPOINT'
           ELSE 'UNRESOLVED'
         END AS classification
       FROM routes r
       LEFT JOIN best_start bs ON bs.route_id=r.id
       LEFT JOIN best_end be ON be.route_id=r.id
     ),
     shared_assoc AS (
       SELECT
         c.id AS route_id,
         array_agg(DISTINCT a.canonical_name ORDER BY a.canonical_name) AS shared_associations
       FROM classified c
       JOIN taxi_rank_association sa ON sa.taxi_rank_id=c.start_rank_id
       JOIN taxi_rank_association ea ON ea.taxi_rank_id=c.end_rank_id
       JOIN taxi_association a ON a.id=sa.association_id AND a.id=ea.association_id
       GROUP BY c.id
     )
     SELECT
       c.*,
       coalesce(cardinality(s.shared_associations),0)::int AS shared_association_count,
       s.shared_associations
     FROM classified c
     LEFT JOIN shared_assoc s ON s.route_id=c.id
     ORDER BY
       CASE c.classification
         WHEN 'EXACT_ENDPOINT_PAIR' THEN 1
         WHEN 'REVIEW_ENDPOINT_PAIR' THEN 2
         WHEN 'PARTIAL_ENDPOINT' THEN 3
         ELSE 4
       END,
       c.external_record_id`,
    [sourceId]
  );

  const summary={
    geometries:result.rows.length,
    EXACT_ENDPOINT_PAIR:0,
    REVIEW_ENDPOINT_PAIR:0,
    PARTIAL_ENDPOINT:0,
    UNRESOLVED:0,
    exactWithSharedAssociation:0
  };

  for(const row of result.rows){
    summary[row.classification]+=1;
    if(row.classification==='EXACT_ENDPOINT_PAIR' && Number(row.shared_association_count)>0){
      summary.exactWithSharedAssociation+=1;
    }
  }

  const samples=result.rows
    .filter(row=>row.classification==='EXACT_ENDPOINT_PAIR')
    .slice(0,25)
    .map(row=>({
      externalRecordId:row.external_record_id,
      routeCode:row.route_code,
      municipality:row.municipality,
      startRank:row.start_rank_name,
      startDistanceM:Number(Number(row.start_distance_m).toFixed(1)),
      endRank:row.end_rank_name,
      endDistanceM:Number(Number(row.end_distance_m).toFixed(1)),
      sharedAssociations:row.shared_associations || []
    }));

  await client.query('ROLLBACK');

  console.log(JSON.stringify({
    event:'tn6_i_kzn_route_reconciliation_read_only',
    sourceKey,
    databaseWrites:false,
    policy:{
      exactEndpointMaxDistanceM:50,
      reviewEndpointMaxDistanceM:100,
      exactRequiresUniqueWithin100m:true,
      exactRequiresDistinctEndpoints:true,
      canonicalRouteWrites:false
    },
    summary,
    samples
  }));
}catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  console.error(JSON.stringify({
    event:'tn6_i_kzn_route_reconciliation_failed',
    error:String(error?.message || error)
  }));
  process.exitCode=1;
}finally{
  client.release();
  await pool.end();
}
