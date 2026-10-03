import pg from 'pg';

const { Pool }=pg;
if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3,ssl:false});
const client=await pool.connect();

function endpointIssueKey(routeId,side,label){
  return ['nltis-endpoint',routeId,side,String(label || '').trim().toUpperCase()].join('|');
}

async function classifyLabel(label){
  if(!label) return {classification:'UNRESOLVED',matches:[]};

  const result=await client.query(
    `SELECT id::text,canonical_name,province,municipality,town
     FROM taxi_rank
     WHERE upper(trim(canonical_name))=upper(trim($1))
     ORDER BY id`,
    [label]
  );

  if(result.rows.length===1){
    return {classification:'EXACT',matches:result.rows};
  }
  if(result.rows.length===0){
    return {classification:'UNRESOLVED',matches:[]};
  }
  return {classification:'AMBIGUOUS',matches:result.rows};
}

async function upsertIssue({route,side,label,classification,matches}){
  const issueKey=endpointIssueKey(route.id,side,label);
  const severity=classification==='AMBIGUOUS' ? 'warning' : 'info';
  const detail={
    issueKey,
    routeId:route.id,
    associationId:route.association_id,
    associationName:route.association_name,
    associationRegistration:route.registration_number,
    sourceKey:route.source_key,
    side,
    label,
    classification,
    candidateRankIds:matches.map(row=>row.id),
    candidateRankNames:matches.map(row=>row.canonical_name),
    autoMerge:false,
    exactMatchOnly:true
  };

  await client.query(
    `INSERT INTO data_issue
      (entity_type,entity_id,issue_type,severity,summary,detail,status)
     SELECT
      'nltis_route_endpoint',$1::uuid,'nltis_endpoint_reconciliation',$2,$3,$4::jsonb,'open'
     WHERE NOT EXISTS (
       SELECT 1 FROM data_issue
       WHERE issue_type='nltis_endpoint_reconciliation'
         AND detail->>'issueKey'=$5
         AND status IN ('open','reviewing','deferred')
     )`,
    [
      route.id,
      severity,
      'NLTIS endpoint ' + classification + ': ' + side + ' ' + label,
      JSON.stringify(detail),
      issueKey
    ]
  );
}

try{
  const routes=await client.query(
    `SELECT DISTINCT
       tr.id::text,
       tr.association_id::text,
       tr.origin_label,
       tr.destination_label,
       tr.origin_rank_id::text,
       tr.destination_rank_id::text,
       a.canonical_name AS association_name,
       a.registration_number,
       s.source_key
     FROM taxi_route tr
     JOIN taxi_association a ON a.id=tr.association_id
     JOIN source_record sr
       ON sr.entity_type='taxi_route' AND sr.entity_id=tr.id
     JOIN source_registry s ON s.id=sr.source_id
     WHERE s.source_class='nltis_olas'
       AND tr.verification_status='documented'
     ORDER BY registration_number,id`
  );

  await client.query('BEGIN');

  const summary={
    routes:routes.rows.length,
    endpoints:0,
    exact:0,
    unresolved:0,
    ambiguous:0,
    rankLinksWritten:0,
    associationLinksWritten:0
  };

  for(const route of routes.rows){
    for(const side of ['origin','destination']){
      const label=side==='origin' ? route.origin_label : route.destination_label;
      const currentRankId=side==='origin' ? route.origin_rank_id : route.destination_rank_id;
      const result=await classifyLabel(label);

      summary.endpoints+=1;
      if(result.classification==='EXACT') summary.exact+=1;
      if(result.classification==='UNRESOLVED') summary.unresolved+=1;
      if(result.classification==='AMBIGUOUS') summary.ambiguous+=1;

      if(result.classification==='EXACT'){
        const rankId=result.matches[0].id;

        if(currentRankId!==rankId){
          const column=side==='origin' ? 'origin_rank_id' : 'destination_rank_id';
          await client.query(
            `UPDATE taxi_route SET ${column}=$2::uuid,updated_at=now() WHERE id=$1::uuid`,
            [route.id,rankId]
          );
          summary.rankLinksWritten+=1;
        }

        const linked=await client.query(
          `INSERT INTO taxi_rank_association
            (taxi_rank_id,association_id,verification_status,first_seen_at,last_seen_at)
           VALUES ($1::uuid,$2::uuid,'documented',now(),now())
           ON CONFLICT (taxi_rank_id,association_id) DO UPDATE SET
             verification_status='documented',
             last_seen_at=now()
           RETURNING taxi_rank_id`,
          [rankId,route.association_id]
        );
        if(linked.rowCount===1) summary.associationLinksWritten+=1;
      }else{
        if(currentRankId){
          const column=side==='origin' ? 'origin_rank_id' : 'destination_rank_id';
          await client.query(
            `UPDATE taxi_route SET ${column}=NULL,updated_at=now() WHERE id=$1::uuid`,
            [route.id]
          );
        }
        await upsertIssue({
          route,
          side,
          label,
          classification:result.classification,
          matches:result.matches
        });
      }
    }
  }

  await client.query('COMMIT');

  const proof=await client.query(
    `SELECT
       count(*) FILTER (WHERE origin_rank_id IS NOT NULL)::int AS origin_links,
       count(*) FILTER (WHERE destination_rank_id IS NOT NULL)::int AS destination_links
     FROM taxi_route tr
     JOIN source_record sr
       ON sr.entity_type='taxi_route' AND sr.entity_id=tr.id
     JOIN source_registry s ON s.id=sr.source_id
     WHERE s.source_class='nltis_olas'
       AND tr.verification_status='documented'`
  );

  console.log(JSON.stringify({
    event:'nltis_endpoint_reconciliation_complete',
    summary,
    database:proof.rows[0]
  }));
}catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  console.error(JSON.stringify({
    event:'nltis_endpoint_reconciliation_failed',
    error:String(error?.message || error)
  }));
  process.exitCode=1;
}finally{
  client.release();
  await pool.end();
}
