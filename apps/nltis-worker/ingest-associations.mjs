import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const { Pool }=pg;
if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const root=resolve(new URL('.',import.meta.url).pathname);
const sources=JSON.parse(await readFile(resolve(root,'sources.json'),'utf8'));
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3,ssl:false});
const client=await pool.connect();

try{
  const schema=await client.query(
    "select to_regclass('public.taxi_association') association_table, to_regclass('public.source_registry') source_registry_table, to_regclass('public.source_record') source_record_table"
  );
  const row=schema.rows[0];
  if(!row.association_table || !row.source_registry_table || !row.source_record_table){
    throw new Error('Required transport schema is not present');
  }

  await client.query('BEGIN');

  const summary=[];

  for(const source of sources){
    const registry=await client.query(
      `INSERT INTO source_registry
        (source_key,source_name,authority,source_class,source_url,coverage,official,legacy,last_checked_at)
       VALUES ($1,$2,'National Land Transport Information System','nltis_olas',$3,$4,true,false,now())
       ON CONFLICT (source_key) DO UPDATE SET
         source_name=excluded.source_name,
         authority=excluded.authority,
         source_url=excluded.source_url,
         coverage=excluded.coverage,
         official=true,
         legacy=false,
         last_checked_at=now(),
         updated_at=now()
       RETURNING id`,
      [source.id,'NLTIS RAS - '+source.associationName,source.url,source.province]
    );
    const sourceId=registry.rows[0].id;

    const existing=await client.query(
      `SELECT id::text FROM taxi_association WHERE registration_number=$1 ORDER BY id LIMIT 2`,
      [source.registrationNumber]
    );

    let associationId;
    let action;

    if(existing.rows.length===1){
      associationId=existing.rows[0].id;
      await client.query(
        `UPDATE taxi_association SET
           canonical_name=$2,
           province=$3,
           verification_status='documented',
           last_verified_at=now(),
           updated_at=now()
         WHERE id=$1::uuid`,
        [associationId,source.associationName,source.province]
      );
      action='updated';
    }else if(existing.rows.length>1){
      throw new Error('Duplicate association registration number: '+source.registrationNumber);
    }else{
      const inserted=await client.query(
        `INSERT INTO taxi_association
          (canonical_name,registration_number,province,verification_status,last_verified_at)
         VALUES ($1,$2,$3,'documented',now())
         RETURNING id::text`,
        [source.associationName,source.registrationNumber,source.province]
      );
      associationId=inserted.rows[0].id;
      action='created';
    }

    await client.query(
      `INSERT INTO source_record
        (source_id,entity_type,entity_id,external_record_id,source_payload,source_last_checked_at,source_confidence)
       VALUES ($1,'taxi_association',$2::uuid,$3,$4::jsonb,now(),1.0)
       ON CONFLICT (source_id,entity_type,external_record_id) DO UPDATE SET
         entity_id=excluded.entity_id,
         source_payload=excluded.source_payload,
         source_last_checked_at=now(),
         source_retrieved_at=now(),
         source_confidence=1.0`,
      [
        sourceId,
        associationId,
        'association:'+source.registrationNumber,
        JSON.stringify({
          sourceId:source.id,
          associationId:source.associationId,
          associationName:source.associationName,
          registrationNumber:source.registrationNumber,
          province:source.province,
          url:source.url,
          identityOnly:true,
          routeAcquisitionIndependent:true
        })
      ]
    );

    summary.push({
      sourceId:source.id,
      associationName:source.associationName,
      registrationNumber:source.registrationNumber,
      action
    });
  }

  await client.query('COMMIT');

  const proof=await client.query(
    `SELECT
       count(*)::int associations,
       count(*) FILTER (WHERE verification_status='documented')::int documented_associations
     FROM taxi_association`
  );

  console.log(JSON.stringify({
    event:'nltis_association_identity_ingest_complete',
    sourceCount:sources.length,
    summary,
    database:proof.rows[0]
  }));
}catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  console.error(JSON.stringify({event:'nltis_association_identity_ingest_failed',error:String(error?.message || error)}));
  process.exitCode=1;
}finally{
  client.release();
  await pool.end();
}
