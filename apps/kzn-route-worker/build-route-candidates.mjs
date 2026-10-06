import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const { Pool }=pg;
if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const sourceKey='kzn-dot-taxi-routes-2026';
const root=resolve(new URL('.',import.meta.url).pathname);
const dryRun=process.env.ROUTE_CANDIDATE_DRY_RUN==='true';
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2,ssl:false});
const client=await pool.connect();

try{
  const schemaState=await client.query(
    "select to_regclass('public.source_route_geometry') source_geometry, to_regclass('public.route_candidate') route_candidate"
  );
  if(!schemaState.rows[0].source_geometry){
    throw new Error('source_route_geometry schema is not present');
  }
  if(!schemaState.rows[0].route_candidate){
    const schemaSql=await readFile(resolve(root,'route-candidate-schema.sql'),'utf8');
    await client.query(schemaSql);
  }

  const source=await client.query('SELECT id FROM source_registry WHERE source_key=$1',[sourceKey]);
  if(source.rows.length!==1) throw new Error('KZN source not found');
  const sourceId=source.rows[0].id;

  const result=await client.query(
    `WITH routes AS (
       SELECT
         srg.id,
         srg.external_record_id,
         srg.route_code,
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
       WHERE srg.source_id=$1 AND srg.geometry IS NOT NULL
     ),
     start_candidates AS (
       SELECT r.id route_id,tr.id rank_id,tr.canonical_name,
              ST_DistanceSphere(r.start_pt,tr.location) distance_m,
              count(*) OVER (PARTITION BY r.id) within_100_count
       FROM routes r
       JOIN taxi_rank tr
         ON tr.province='KwaZulu-Natal'
        AND tr.location IS NOT NULL
        AND ST_DWithin(r.start_pt::geography,tr.location::geography,100)
     ),
     end_candidates AS (
       SELECT r.id route_id,tr.id rank_id,tr.canonical_name,
              ST_DistanceSphere(r.end_pt,tr.location) distance_m,
              count(*) OVER (PARTITION BY r.id) within_100_count
       FROM routes r
       JOIN taxi_rank tr
         ON tr.province='KwaZulu-Natal'
        AND tr.location IS NOT NULL
        AND ST_DWithin(r.end_pt::geography,tr.location::geography,100)
     ),
     best_start AS (
       SELECT DISTINCT ON (route_id) route_id,rank_id,canonical_name,distance_m,within_100_count
       FROM start_candidates ORDER BY route_id,distance_m,rank_id
     ),
     best_end AS (
       SELECT DISTINCT ON (route_id) route_id,rank_id,canonical_name,distance_m,within_100_count
       FROM end_candidates ORDER BY route_id,distance_m,rank_id
     )
     SELECT
       r.id source_route_geometry_id,
       r.external_record_id,
       r.route_code,
       bs.rank_id origin_rank_id,
       bs.canonical_name origin_name,
       bs.distance_m origin_distance_m,
       be.rank_id destination_rank_id,
       be.canonical_name destination_name,
       be.distance_m destination_distance_m
     FROM routes r
     JOIN best_start bs ON bs.route_id=r.id
     JOIN best_end be ON be.route_id=r.id
     WHERE bs.rank_id<>be.rank_id
       AND bs.distance_m<=50
       AND be.distance_m<=50
       AND bs.within_100_count=1
       AND be.within_100_count=1
     ORDER BY r.external_record_id`,
    [sourceId]
  );

  if(dryRun){
    console.log(JSON.stringify({
      event:'tn6_j_route_candidate_dry_run',
      sourceKey,
      databaseWrites:false,
      eligible:result.rows.length,
      samples:result.rows.slice(0,20).map(row=>({
        externalRecordId:row.external_record_id,
        routeCode:row.route_code,
        origin:row.origin_name,
        destination:row.destination_name,
        originDistanceM:Number(Number(row.origin_distance_m).toFixed(1)),
        destinationDistanceM:Number(Number(row.destination_distance_m).toFixed(1))
      }))
    }));
  }else{
    await client.query('BEGIN');
    let created=0,updated=0;

    for(const row of result.rows){
      const shared=await client.query(
        `SELECT a.id::text,a.canonical_name
         FROM taxi_rank_association oa
         JOIN taxi_rank_association da ON da.association_id=oa.association_id
         JOIN taxi_association a ON a.id=oa.association_id
         WHERE oa.taxi_rank_id=$1 AND da.taxi_rank_id=$2
         ORDER BY a.id`,
        [row.origin_rank_id,row.destination_rank_id]
      );

      const associationId=shared.rows.length===1 ? shared.rows[0].id : null;
      const provenance={
        sourceKey,
        classification:'EXACT_ENDPOINT_PAIR',
        associationEvidence:shared.rows.length===1 ? 'unique_shared_association' : 'none_or_ambiguous',
        sharedAssociations:shared.rows.map(x=>x.canonical_name),
        canonicalRoutePromotion:false
      };

      const write=await client.query(
        `INSERT INTO route_candidate
          (source_route_geometry_id,source_id,external_record_id,route_code,
           origin_rank_id,destination_rank_id,association_id,
           origin_distance_m,destination_distance_m,reconciliation_status,
           verification_status,confidence,provenance,last_seen_at)
         VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,'exact_endpoint_pair','documented',1.0,$10::jsonb,now())
         ON CONFLICT (source_route_geometry_id) DO UPDATE SET
           source_id=excluded.source_id,
           external_record_id=excluded.external_record_id,
           route_code=excluded.route_code,
           origin_rank_id=excluded.origin_rank_id,
           destination_rank_id=excluded.destination_rank_id,
           association_id=excluded.association_id,
           origin_distance_m=excluded.origin_distance_m,
           destination_distance_m=excluded.destination_distance_m,
           reconciliation_status='exact_endpoint_pair',
           verification_status='documented',
           confidence=1.0,
           provenance=excluded.provenance,
           last_seen_at=now()
         RETURNING (xmax=0) inserted`,
        [
          row.source_route_geometry_id,sourceId,row.external_record_id,row.route_code,
          row.origin_rank_id,row.destination_rank_id,associationId,
          Number(row.origin_distance_m),Number(row.destination_distance_m),
          JSON.stringify(provenance)
        ]
      );
      if(write.rows[0]?.inserted) created+=1; else updated+=1;
    }

    await client.query('COMMIT');

    const proof=await client.query(
      `SELECT
         count(*)::int total,
         count(*) FILTER (WHERE association_id IS NOT NULL)::int with_association,
         count(*) FILTER (WHERE association_id IS NULL)::int association_pending
       FROM route_candidate
       WHERE source_id=$1`,
      [sourceId]
    );

    console.log(JSON.stringify({
      event:'tn6_j_route_candidate_build_complete',
      sourceKey,
      eligible:result.rows.length,
      created,
      updated,
      canonicalRouteWrites:false,
      database:proof.rows[0]
    }));
  }
}catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  console.error(JSON.stringify({event:'tn6_j_route_candidate_build_failed',error:String(error?.message || error)}));
  process.exitCode=1;
}finally{
  client.release();
  await pool.end();
}
