import pg from 'pg';

const { Pool }=pg;
if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const sourceKey='ethekwini-bus-taxi-ranks-degraded';
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3,ssl:false});
const client=await pool.connect();

function normalizedSql(column){
  return `regexp_replace(regexp_replace(lower(trim(${column})),'&',' and ','g'),'[^a-z0-9]+',' ','g')`;
}

function eligible(label){
  const value=String(label || '').trim();
  if(!value) return false;
  if(/committee/i.test(value)) return false;
  if(/\bregion\b/i.test(value)) return false;
  if(/transport services/i.test(value)) return false;
  if(/taxi rank$/i.test(value) && !/association/i.test(value)) return false;
  return /taxi association|taxi owners association|taxi rank association/i.test(value);
}

try{
  const schema=await client.query(
    "select to_regclass('public.rank_association_candidate') candidates, to_regclass('public.taxi_association') associations, to_regclass('public.taxi_rank_association') links"
  );
  if(!schema.rows[0].candidates || !schema.rows[0].associations || !schema.rows[0].links){
    throw new Error('Required association promotion schema is not present');
  }

  const rows=await client.query(
    `SELECT
       rac.normalized_label,
       min(rac.association_label) AS association_label,
       array_agg(DISTINCT rac.taxi_rank_id::text ORDER BY rac.taxi_rank_id::text) AS rank_ids,
       array_agg(DISTINCT rac.source_rank_external_id ORDER BY rac.source_rank_external_id) AS source_rank_external_ids,
       min(s.id)::text AS source_id
     FROM rank_association_candidate rac
     JOIN source_registry s ON s.id=rac.source_id
     WHERE s.source_key=$1
     GROUP BY rac.normalized_label
     ORDER BY rac.normalized_label`,
    [sourceKey]
  );

  const selected=rows.rows.filter(row=>eligible(row.association_label));

  await client.query('BEGIN');

  let created=0,reused=0,linksCreated=0,linksUpdated=0;

  for(const row of selected){
    const exact=await client.query(
      `SELECT id::text,canonical_name
       FROM taxi_association
       WHERE ${normalizedSql('canonical_name')}=$1
       ORDER BY id`,
      [row.normalized_label]
    );

    let associationId;

    if(exact.rows.length===1){
      associationId=exact.rows[0].id;
      reused+=1;
      await client.query(
        `UPDATE taxi_association SET
           canonical_name=$2,
           province='KwaZulu-Natal',
           municipality='eThekwini Metropolitan Municipality',
           verification_status='documented',
           confidence=1.0,
           last_verified_at=now(),
           updated_at=now()
         WHERE id=$1::uuid`,
        [associationId,row.association_label]
      );
    }else if(exact.rows.length>1){
      throw new Error('Ambiguous canonical association match: '+row.association_label);
    }else{
      const inserted=await client.query(
        `INSERT INTO taxi_association
          (canonical_name,province,municipality,verification_status,confidence,last_verified_at)
         VALUES
          ($1,'KwaZulu-Natal','eThekwini Metropolitan Municipality','documented',1.0,now())
         RETURNING id::text`,
        [row.association_label]
      );
      associationId=inserted.rows[0].id;
      created+=1;
    }

    await client.query(
      `INSERT INTO source_record
        (source_id,entity_type,entity_id,external_record_id,source_payload,source_last_checked_at,source_confidence)
       VALUES
        ($1::uuid,'taxi_association',$2::uuid,$3,$4::jsonb,now(),1.0)
       ON CONFLICT (source_id,entity_type,external_record_id) DO UPDATE SET
         entity_id=excluded.entity_id,
         source_payload=excluded.source_payload,
         source_last_checked_at=now(),
         source_retrieved_at=now(),
         source_confidence=1.0`,
      [
        row.source_id,
        associationId,
        'association-label:'+row.normalized_label,
        JSON.stringify({
          sourceKey,
          associationLabel:row.association_label,
          normalizedLabel:row.normalized_label,
          rankIds:row.rank_ids,
          sourceRankExternalIds:row.source_rank_external_ids,
          promotionRule:'explicit_taxi_association_label_only',
          registrationNumber:null
        })
      ]
    );

    for(const rankId of row.rank_ids){
      const link=await client.query(
        `INSERT INTO taxi_rank_association
          (taxi_rank_id,association_id,verification_status,confidence,first_seen_at,last_seen_at)
         VALUES ($1::uuid,$2::uuid,'documented',1.0,now(),now())
         ON CONFLICT (taxi_rank_id,association_id) DO UPDATE SET
           verification_status='documented',
           confidence=1.0,
           last_seen_at=now()
         RETURNING (xmax=0) AS inserted`,
        [rankId,associationId]
      );
      if(link.rows[0]?.inserted) linksCreated+=1;
      else linksUpdated+=1;
    }
  }

  await client.query('COMMIT');

  const proof=await client.query(
    `SELECT
       (SELECT count(*)::int FROM taxi_association) total_associations,
       (SELECT count(*)::int FROM taxi_association WHERE municipality='eThekwini Metropolitan Municipality') ethekwini_associations,
       (SELECT count(*)::int
          FROM taxi_rank_association tra
          JOIN taxi_association a ON a.id=tra.association_id
          WHERE a.municipality='eThekwini Metropolitan Municipality') ethekwini_rank_links`
  );

  console.log(JSON.stringify({
    event:'ethekwini_association_promotion_complete',
    candidates:rows.rows.length,
    eligible:selected.length,
    created,
    reused,
    linksCreated,
    linksUpdated,
    database:proof.rows[0],
    excluded:rows.rows
      .filter(row=>!eligible(row.association_label))
      .map(row=>row.association_label)
  }));
}catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  console.error(JSON.stringify({
    event:'ethekwini_association_promotion_failed',
    error:String(error?.message || error)
  }));
  process.exitCode=1;
}finally{
  client.release();
  await pool.end();
}
