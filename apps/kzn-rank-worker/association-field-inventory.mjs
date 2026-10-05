import pg from 'pg';

const {Pool}=pg;
if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const sourceKey='kzn-taxi-ranks-degraded-tls';
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,ssl:false});
const client=await pool.connect();

try{
  await client.query('BEGIN READ ONLY');

  const keys=await client.query(
    `SELECT key,
            count(*)::int observations,
            count(*) FILTER (WHERE nullif(trim(value),'') IS NOT NULL)::int nonblank
     FROM source_record sr
     JOIN source_registry s ON s.id=sr.source_id,
          LATERAL jsonb_each_text(sr.source_payload)
     WHERE s.source_key=$1
       AND sr.entity_type='taxi_rank'
     GROUP BY key
     ORDER BY key`,
    [sourceKey]
  );

  const assocLike=keys.rows.filter(row=>/assoc|operator|owner|org|taxi|route|name|rank/i.test(row.key));
  const samples=[];

  for(const row of assocLike.slice(0,20)){
    const q=await client.query(
      `SELECT DISTINCT nullif(trim(sr.source_payload->>$1),'') AS value
       FROM source_record sr
       JOIN source_registry s ON s.id=sr.source_id
       WHERE s.source_key=$2
         AND sr.entity_type='taxi_rank'
         AND nullif(trim(sr.source_payload->>$1),'') IS NOT NULL
       ORDER BY 1
       LIMIT 15`,
      [row.key,sourceKey]
    );

    samples.push({
      key:row.key,
      observations:row.observations,
      nonblank:row.nonblank,
      values:q.rows.map(x=>x.value)
    });
  }

  await client.query('ROLLBACK');

  console.log(JSON.stringify({
    event:'tn6_l_kzn_association_field_inventory',
    sourceKey,
    databaseWrites:false,
    assocLike,
    samples
  }));
}catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  console.error(JSON.stringify({
    event:'tn6_l_kzn_association_field_inventory_failed',
    error:String(error?.message || error)
  }));
  process.exitCode=1;
}finally{
  client.release();
  await pool.end();
}
