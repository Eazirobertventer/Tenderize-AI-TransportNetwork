import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const root = resolve(new URL('.', import.meta.url).pathname);
const source = {
  id:'ekurhuleni-corridor-taxi-ranks',
  name:'City of Ekurhuleni Corridor Taxi Ranks',
  authority:'City of Ekurhuleni',
  url:process.env.SOURCE_URL || 'https://gis.ekurhuleni.gov.za/arcgis/rest/services/GMS/Corridor_1/MapServer/52',
  outFields:'OBJECTID,FID,NAME,NEW_REGION,REGION,TOWN,PHYSICAL_A,REF_NUMBER,LATTITUDE_,LONGITUDE_',
  mapping:{
    external_id:'OBJECTID',
    name:'NAME',
    province:'Gauteng',
    municipality:'City of Ekurhuleni',
    region:'NEW_REGION',
    town:'TOWN',
    address:'PHYSICAL_A',
    latitude:'LATTITUDE_',
    longitude:'LONGITUDE_'
  }
};

const pool = new Pool({
  connectionString:databaseUrl,
  max:3,
  ssl:false
});

async function ensureSchema(client){
  const initial=await client.query("select to_regclass('public.taxi_rank') as table_name");
  if(!initial.rows[0].table_name){
    const sql=await readFile(resolve(root,'schema/001_initial.sql'),'utf8');
    await client.query(sql);
  }

  const candidates=await client.query("select to_regclass('public.rank_association_candidate') as table_name");
  if(!candidates.rows[0].table_name){
    const sql=await readFile(resolve(root,'schema/002_relation_candidates.sql'),'utf8');
    await client.query(sql);
  }
}

async function fetchSource(){
  const query=new URLSearchParams({
    where:'1=1',
    outFields:source.outFields,
    returnGeometry:'true',
    outSR:'4326',
    f:'json'
  });

  const response=await fetch(source.url + '/query?' + query,{
    headers:{'user-agent':'TenderizeTransportNetwork/0.3 canonical-ingest'},
    signal:AbortSignal.timeout(30000)
  });

  if(!response.ok) throw new Error('ArcGIS HTTP ' + response.status + ' ' + response.statusText);
  const body=await response.json();
  if(body?.error) throw new Error('ArcGIS ' + body.error.code + ': ' + body.error.message);
  if(!Array.isArray(body.features)) throw new Error('ArcGIS response has no features array');
  return body.features;
}

function normalise(feature){
  const a=feature.attributes || {};
  const m=source.mapping;
  const latitude=Number(a[m.latitude] ?? feature.geometry?.y);
  const longitude=Number(a[m.longitude] ?? feature.geometry?.x);

  return {
    externalId:String(a[m.external_id] ?? ''),
    canonicalName:String(a[m.name] ?? '').trim(),
    province:m.province,
    municipality:m.municipality,
    region:String(a[m.region] ?? '').trim() || null,
    town:String(a[m.town] ?? '').trim() || null,
    address:String(a[m.address] ?? '').trim() || null,
    latitude,
    longitude,
    payload:a
  };
}

function valid(record){
  return record.externalId &&
    record.canonicalName &&
    Number.isFinite(record.latitude) &&
    Number.isFinite(record.longitude) &&
    record.latitude >= -36 && record.latitude <= -20 &&
    record.longitude >= 15 && record.longitude <= 34;
}

const client=await pool.connect();

try{
  await ensureSchema(client);
  const features=await fetchSource();
  const records=features.map(normalise).filter(valid);

  if(records.length===0){
    throw new Error('Fail closed: source returned zero valid taxi-rank records');
  }

  await client.query('BEGIN');

  const sourceRow=await client.query(
    `INSERT INTO source_registry
      (source_key,source_name,authority,source_class,source_url,coverage,official,legacy,last_checked_at)
     VALUES ($1,$2,$3,'official_gis',$4,$5,true,false,now())
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
    [source.id,source.name,source.authority,source.url,'City of Ekurhuleni, Gauteng']
  );

  const sourceUuid=sourceRow.rows[0].id;
  let created=0;
  let updated=0;

  for(const record of records){
    const existing=await client.query(
      `SELECT entity_id
       FROM source_record
       WHERE source_id=$1
         AND entity_type='taxi_rank'
         AND external_record_id=$2`,
      [sourceUuid,record.externalId]
    );

    let rankId;

    if(existing.rows[0]?.entity_id){
      rankId=existing.rows[0].entity_id;
      await client.query(
        `UPDATE taxi_rank SET
           canonical_name=$2,
           province=$3,
           municipality=$4,
           town=$5,
           address=$6,
           location=ST_SetSRID(ST_MakePoint($7,$8),4326),
           verification_status='official',
           last_verified_at=now(),
           updated_at=now()
         WHERE id=$1`,
        [rankId,record.canonicalName,record.province,record.municipality,record.town,record.address,record.longitude,record.latitude]
      );
      updated+=1;
    }else{
      const inserted=await client.query(
        `INSERT INTO taxi_rank
          (canonical_name,province,municipality,town,address,location,verification_status,last_verified_at)
         VALUES
          ($1,$2,$3,$4,$5,ST_SetSRID(ST_MakePoint($6,$7),4326),'official',now())
         RETURNING id`,
        [record.canonicalName,record.province,record.municipality,record.town,record.address,record.longitude,record.latitude]
      );
      rankId=inserted.rows[0].id;
      created+=1;
    }

    await client.query(
      `INSERT INTO source_record
        (source_id,entity_type,entity_id,external_record_id,source_payload,source_geometry,source_last_checked_at)
       VALUES
        ($1,'taxi_rank',$2,$3,$4::jsonb,ST_SetSRID(ST_MakePoint($5,$6),4326),now())
       ON CONFLICT (source_id,entity_type,external_record_id) DO UPDATE SET
         entity_id=excluded.entity_id,
         source_payload=excluded.source_payload,
         source_geometry=excluded.source_geometry,
         source_last_checked_at=now(),
         source_retrieved_at=now()`,
      [sourceUuid,rankId,record.externalId,JSON.stringify(record.payload),record.longitude,record.latitude]
    );
  }

  await client.query('COMMIT');

  const proof=await client.query(
    `SELECT
       count(*)::int AS ranks,
       count(*) FILTER (WHERE verification_status='official')::int AS official_ranks
     FROM taxi_rank`
  );

  console.log(JSON.stringify({
    event:'canonical_ingest_complete',
    sourceId:source.id,
    fetched:features.length,
    valid:records.length,
    created,
    updated,
    database:proof.rows[0]
  }));
}catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  console.error(JSON.stringify({
    event:'canonical_ingest_failed',
    sourceId:source.id,
    error:String(error?.message || error)
  }));
  process.exitCode=1;
}finally{
  client.release();
  await pool.end();
}
