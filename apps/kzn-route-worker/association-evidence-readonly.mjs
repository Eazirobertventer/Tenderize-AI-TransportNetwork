import pg from 'pg';

const {Pool}=pg;
if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const sourceKey='kzn-dot-taxi-routes-2026';
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,ssl:false});
const client=await pool.connect();

try{
  await client.query('BEGIN READ ONLY');

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
              array_agg(DISTINCT a.id ORDER BY a.id) association_ids,
              array_agg(DISTINCT a.canonical_name ORDER BY a.canonical_name) association_names
       FROM candidates c
       JOIN taxi_rank_association tra ON tra.taxi_rank_id=c.origin_rank_id
       JOIN taxi_association a ON a.id=tra.association_id
       GROUP BY c.id
     ),
     destination_assoc AS (
       SELECT c.id route_candidate_id,
              array_agg(DISTINCT a.id ORDER BY a.id) association_ids,
              array_agg(DISTINCT a.canonical_name ORDER BY a.canonical_name) association_names
       FROM candidates c
       JOIN taxi_rank_association tra ON tra.taxi_rank_id=c.destination_rank_id
       JOIN taxi_association a ON a.id=tra.association_id
       GROUP BY c.id
     )
     SELECT c.*,
            coalesce(cardinality(oa.association_ids),0)::int origin_association_count,
            coalesce(cardinality(da.association_ids),0)::int destination_association_count,
            oa.association_ids origin_association_ids,
            oa.association_names origin_association_names,
            da.association_ids destination_association_ids,
            da.association_names destination_association_names
     FROM candidates c
     LEFT JOIN origin_assoc oa ON oa.route_candidate_id=c.id
     LEFT JOIN destination_assoc da ON da.route_candidate_id=c.id
     ORDER BY c.external_record_id`,
    [sourceKey]
  );

  const summary={
    total:rows.rows.length,
    SHARED_EXPLICIT_ASSOCIATION:0,
    ORIGIN_ONLY_ASSOCIATION:0,
    DESTINATION_ONLY_ASSOCIATION:0,
    CONFLICTING_ENDPOINT_ASSOCIATIONS:0,
    NO_ASSOCIATION_EVIDENCE:0
  };

  const classified=[];

  for(const row of rows.rows){
    const originIds=(row.origin_association_ids||[]).map(String);
    const destinationIds=(row.destination_association_ids||[]).map(String);
    const shared=originIds.filter(id=>destinationIds.includes(id));

    let classification;
    if(shared.length===1 && originIds.length===1 && destinationIds.length===1){
      classification='SHARED_EXPLICIT_ASSOCIATION';
    }else if(originIds.length>0 && destinationIds.length===0){
      classification='ORIGIN_ONLY_ASSOCIATION';
    }else if(originIds.length===0 && destinationIds.length>0){
      classification='DESTINATION_ONLY_ASSOCIATION';
    }else if(originIds.length>0 && destinationIds.length>0){
      classification='CONFLICTING_ENDPOINT_ASSOCIATIONS';
    }else{
      classification='NO_ASSOCIATION_EVIDENCE';
    }

    summary[classification]+=1;
    classified.push({
      externalRecordId:row.external_record_id,
      routeCode:row.route_code,
      origin:row.origin_name,
      destination:row.destination_name,
      classification,
      originAssociations:row.origin_association_names||[],
      destinationAssociations:row.destination_association_names||[]
    });
  }

  await client.query('ROLLBACK');

  console.log(JSON.stringify({
    event:'tn6_l_route_candidate_association_inventory',
    sourceKey,
    databaseWrites:false,
    summary,
    samples:classified.filter(x=>x.classification!=='NO_ASSOCIATION_EVIDENCE').slice(0,30)
  }));
}catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  console.error(JSON.stringify({
    event:'tn6_l_route_candidate_association_inventory_failed',
    error:String(error?.message||error)
  }));
  process.exitCode=1;
}finally{
  client.release();
  await pool.end();
}
