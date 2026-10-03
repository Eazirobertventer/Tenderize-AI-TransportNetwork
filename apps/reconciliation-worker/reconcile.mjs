import pg from 'pg';

const { Pool }=pg;
if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const sourceA=process.env.SOURCE_A || 'ethekwini-bus-taxi-ranks-degraded';
const sourceB=process.env.SOURCE_B || 'kzn-taxi-ranks-degraded-tls';
const candidateThresholdM=Number(process.env.CANDIDATE_THRESHOLD_M || 50);
const ambiguityRadiusM=Number(process.env.AMBIGUITY_RADIUS_M || 100);

if(!Number.isFinite(candidateThresholdM) || candidateThresholdM<=0 || candidateThresholdM>100){
  throw new Error('CANDIDATE_THRESHOLD_M must be >0 and <=100');
}
if(!Number.isFinite(ambiguityRadiusM) || ambiguityRadiusM<candidateThresholdM || ambiguityRadiusM>250){
  throw new Error('AMBIGUITY_RADIUS_M must be >= threshold and <=250');
}

const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3,ssl:false});
const client=await pool.connect();

try{
  const result=await client.query(
    `WITH source_a AS (
       SELECT DISTINCT
         r.id,
         r.canonical_name,
         r.location,
         sr.external_record_id,
         s.source_key
       FROM taxi_rank r
       JOIN source_record sr
         ON sr.entity_type='taxi_rank' AND sr.entity_id=r.id
       JOIN source_registry s ON s.id=sr.source_id
       WHERE s.source_key=$1 AND r.location IS NOT NULL
     ),
     source_b AS (
       SELECT DISTINCT
         r.id,
         r.canonical_name,
         r.location,
         sr.external_record_id,
         s.source_key
       FROM taxi_rank r
       JOIN source_record sr
         ON sr.entity_type='taxi_rank' AND sr.entity_id=r.id
       JOIN source_registry s ON s.id=sr.source_id
       WHERE s.source_key=$2 AND r.location IS NOT NULL
     ),
     candidate_pairs AS (
       SELECT
         a.id AS a_id,
         a.canonical_name AS a_name,
         a.external_record_id AS a_external_id,
         a.source_key AS a_source,
         ST_X(a.location) AS a_lng,
         ST_Y(a.location) AS a_lat,
         b.id AS b_id,
         b.canonical_name AS b_name,
         b.external_record_id AS b_external_id,
         b.source_key AS b_source,
         ST_X(b.location) AS b_lng,
         ST_Y(b.location) AS b_lat,
         ST_DistanceSphere(a.location,b.location) AS distance_m,
         count(*) OVER (PARTITION BY a.id) AS matches_within_radius
       FROM source_a a
       JOIN source_b b
         ON ST_DWithin(a.location::geography,b.location::geography,$3)
     ),
     unique_candidates AS (
       SELECT *
       FROM candidate_pairs
       WHERE matches_within_radius=1
         AND distance_m <= $4
     )
     SELECT * FROM unique_candidates
     ORDER BY distance_m,a_name`,
    [sourceA,sourceB,ambiguityRadiusM,candidateThresholdM]
  );

  await client.query('BEGIN');

  let created=0;
  let existing=0;

  for(const row of result.rows){
    const issueKey=[row.a_source,row.a_id,row.b_source,row.b_id].join('|');
    const detail={
      issueKey,
      sourceA:{
        sourceKey:row.a_source,
        rankId:row.a_id,
        name:row.a_name,
        externalRecordId:row.a_external_id,
        coordinates:[Number(row.a_lng),Number(row.a_lat)]
      },
      sourceB:{
        sourceKey:row.b_source,
        rankId:row.b_id,
        name:row.b_name,
        externalRecordId:row.b_external_id,
        coordinates:[Number(row.b_lng),Number(row.b_lat)]
      },
      distanceM:Number(Number(row.distance_m).toFixed(2)),
      matchesWithinAmbiguityRadius:Number(row.matches_within_radius),
      candidateThresholdM,
      ambiguityRadiusM,
      action:'manual_review_required',
      autoMerge:false
    };

    const inserted=await client.query(
      `INSERT INTO data_issue
        (entity_type,entity_id,issue_type,severity,summary,detail,status)
       SELECT
        'taxi_rank_reconciliation',$1::uuid,'duplicate_rank_candidate','warning',$2,$3::jsonb,'open'
       WHERE NOT EXISTS (
         SELECT 1 FROM data_issue
         WHERE issue_type='duplicate_rank_candidate'
           AND detail->>'issueKey'=$4
           AND status IN ('open','reviewing','deferred')
       )
       RETURNING id`,
      [
        row.a_id,
        'Possible duplicate taxi rank: ' + row.a_name + ' ↔ ' + row.b_name + ' (' + Number(row.distance_m).toFixed(1) + 'm)',
        JSON.stringify(detail),
        issueKey
      ]
    );

    if(inserted.rowCount===1) created+=1;
    else existing+=1;
  }

  await client.query('COMMIT');

  const proof=await client.query(
    `SELECT
       count(*)::int AS open_duplicate_candidates
     FROM data_issue
     WHERE issue_type='duplicate_rank_candidate'
       AND status IN ('open','reviewing','deferred')`
  );

  console.log(JSON.stringify({
    event:'rank_reconciliation_complete',
    sourceA,
    sourceB,
    candidateThresholdM,
    ambiguityRadiusM,
    qualifyingPairs:result.rows.length,
    created,
    existing,
    database:proof.rows[0]
  }));
}catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  console.error(JSON.stringify({event:'rank_reconciliation_failed',error:String(error?.message || error)}));
  process.exitCode=1;
}finally{
  client.release();
  await pool.end();
}
