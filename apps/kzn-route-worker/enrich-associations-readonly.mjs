import pg from 'pg';

const { Pool }=pg;
if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const sourceKey='kzn-dot-taxi-routes-2026';
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2,ssl:false});
const client=await pool.connect();

function classify(originAssociations,destinationAssociations){
  const origin=new Set(originAssociations.map(x=>x.id));
  const destination=new Set(destinationAssociations.map(x=>x.id));
  const shared=[...origin].filter(id=>destination.has(id));

  if(shared.length===1){
    return {bucket:'shared',eligibleForAutomaticAssignment:true,sharedAssociationId:shared[0]};
  }
  if(shared.length>1){
    return {bucket:'conflicting',eligibleForAutomaticAssignment:false,sharedAssociationId:null};
  }
  if(origin.size>0 && destination.size>0){
    return {bucket:'conflicting',eligibleForAutomaticAssignment:false,sharedAssociationId:null};
  }
  if(origin.size>0){
    return {bucket:'origin-only',eligibleForAutomaticAssignment:false,sharedAssociationId:null};
  }
  if(destination.size>0){
    return {bucket:'destination-only',eligibleForAutomaticAssignment:false,sharedAssociationId:null};
  }
  return {bucket:'none',eligibleForAutomaticAssignment:false,sharedAssociationId:null};
}

try{
  const schema=await client.query(
    "select to_regclass('public.route_candidate') route_candidate, to_regclass('public.taxi_rank_association') rank_association"
  );
  if(!schema.rows[0].route_candidate || !schema.rows[0].rank_association){
    throw new Error('Required TN6-L schema is not present');
  }

  const rows=await client.query(
    `SELECT
       rc.id::text,
       rc.external_record_id,
       rc.route_code,
       rc.origin_rank_id::text,
       o.canonical_name AS origin_name,
       rc.destination_rank_id::text,
       d.canonical_name AS destination_name,
       coalesce(
         jsonb_agg(DISTINCT jsonb_build_object('id',oa.id::text,'name',oa.canonical_name))
           FILTER (WHERE oa.id IS NOT NULL),
         '[]'::jsonb
       ) AS origin_associations,
       coalesce(
         jsonb_agg(DISTINCT jsonb_build_object('id',da.id::text,'name',da.canonical_name))
           FILTER (WHERE da.id IS NOT NULL),
         '[]'::jsonb
       ) AS destination_associations
     FROM route_candidate rc
     JOIN source_registry s ON s.id=rc.source_id
     JOIN taxi_rank o ON o.id=rc.origin_rank_id
     JOIN taxi_rank d ON d.id=rc.destination_rank_id
     LEFT JOIN taxi_rank_association ora ON ora.taxi_rank_id=rc.origin_rank_id
     LEFT JOIN taxi_association oa ON oa.id=ora.association_id
     LEFT JOIN taxi_rank_association dra ON dra.taxi_rank_id=rc.destination_rank_id
     LEFT JOIN taxi_association da ON da.id=dra.association_id
     WHERE s.source_key=$1
       AND rc.reconciliation_status='exact_endpoint_pair'
     GROUP BY rc.id,o.canonical_name,d.canonical_name
     ORDER BY rc.external_record_id`,
    [sourceKey]
  );

  const items=rows.rows.map(row=>{
    const classification=classify(row.origin_associations,row.destination_associations);
    return {
      routeCandidateId:row.id,
      externalRecordId:row.external_record_id,
      routeCode:row.route_code,
      origin:{id:row.origin_rank_id,name:row.origin_name,associations:row.origin_associations},
      destination:{id:row.destination_rank_id,name:row.destination_name,associations:row.destination_associations},
      ...classification
    };
  });

  const buckets={'shared':0,'origin-only':0,'destination-only':0,'conflicting':0,'none':0};
  for(const item of items) buckets[item.bucket]+=1;

  console.log(JSON.stringify({
    event:'tn6_l_association_evidence_complete',
    sourceKey,
    readOnly:true,
    routeCandidateWrites:false,
    canonicalRouteWrites:false,
    associationWrites:false,
    total:items.length,
    buckets,
    eligibleForAutomaticAssignment:items.filter(x=>x.eligibleForAutomaticAssignment).length,
    items
  }));
}catch(error){
  console.error(JSON.stringify({event:'tn6_l_association_evidence_failed',error:String(error?.message || error)}));
  process.exitCode=1;
}finally{
  client.release();
  await pool.end();
}
