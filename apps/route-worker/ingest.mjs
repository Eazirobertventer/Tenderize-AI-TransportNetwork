import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const { Pool } = pg;
if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const root=resolve(new URL('.',import.meta.url).pathname);
const source=JSON.parse(await readFile(resolve(root,'source.json'),'utf8'));
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3,ssl:false});

async function fetchPage(offset){
  const qs=new URLSearchParams({
    where:'1=1',
    outFields:source.outFields,
    returnGeometry:'true',
    outSR:'4326',
    f:'geojson',
    resultOffset:String(offset),
    resultRecordCount:String(source.pageSize)
  });
  const response=await fetch(source.url + '/query?' + qs,{
    headers:{'user-agent':'TenderizeTransportNetwork/0.4 route-ingest'},
    signal:AbortSignal.timeout(30000)
  });
  if(!response.ok) throw new Error('ArcGIS HTTP ' + response.status + ' ' + response.statusText);
  const body=await response.json();
  if(body?.error) throw new Error('ArcGIS ' + body.error.code + ': ' + body.error.message);
  if(!Array.isArray(body.features)) throw new Error('ArcGIS response has no features array');
  return body.features;
}

function clean(v){ return typeof v==='string' ? v.trim() || null : v ?? null; }

const client=await pool.connect();

try{
  const schema=await client.query("select to_regclass('public.taxi_route') as route_table, to_regclass('public.source_record') as source_table");
  if(!schema.rows[0].route_table || !schema.rows[0].source_table){
    throw new Error('Required transport schema is not present');
  }

  const features=[];
  let offset=0;
  for(;;){
    const page=await fetchPage(offset);
    features.push(...page);
    if(page.length < source.pageSize) break;
    offset += source.pageSize;
  }

  if(features.length===0) throw new Error('Fail closed: source returned zero routes');

  await client.query('BEGIN');

  const sourceRow=await client.query(
    `INSERT INTO source_registry
      (source_key,source_name,authority,source_class,source_url,coverage,official,legacy,last_checked_at)
     VALUES ($1,$2,$3,'official_gis',$4,$5,true,false,now())
     ON CONFLICT (source_key) DO UPDATE SET
       source_name=excluded.source_name, authority=excluded.authority,
       source_url=excluded.source_url, coverage=excluded.coverage,
       official=true, legacy=false, last_checked_at=now(), updated_at=now()
     RETURNING id`,
    [source.id,source.name,source.authority,source.url,'City of Cape Town, Western Cape']
  );
  const sourceId=sourceRow.rows[0].id;

  let created=0,updated=0,quarantined=0;

  for(const feature of features){
    const p=feature.properties || {};
    const externalId=String(p.OBJECTID ?? feature.id ?? '').trim();
    const origin=clean(p.ORGN);
    const destination=clean(p.DSTN);
    const geometry=feature.geometry;

    if(!externalId || !origin || !destination || !geometry || !['LineString','MultiLineString'].includes(geometry.type)){
      quarantined+=1;
      continue;
    }

    const existing=await client.query(
      `SELECT entity_id FROM source_record
       WHERE source_id=$1 AND entity_type='taxi_route' AND external_record_id=$2`,
      [sourceId,externalId]
    );

    let routeId;
    const geometryJson=JSON.stringify(geometry);

    if(existing.rows[0]?.entity_id){
      routeId=existing.rows[0].entity_id;
      await client.query(
        `UPDATE taxi_route SET
           origin_label=$2,
           destination_label=$3,
           route_name=$4,
           route_type='minibus_taxi',
           geometry=ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($5),4326)),
           geometry_status='official_geometry',
           verification_status='official',
           last_verified_at=now(),
           updated_at=now()
         WHERE id=$1`,
        [routeId,origin,destination,origin + ' - ' + destination,geometryJson]
      );
      updated+=1;
    }else{
      const inserted=await client.query(
        `INSERT INTO taxi_route
          (origin_label,destination_label,route_name,route_type,geometry,geometry_status,verification_status,last_verified_at)
         VALUES
          ($1,$2,$3,'minibus_taxi',ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($4),4326)),'official_geometry','official',now())
         RETURNING id`,
        [origin,destination,origin + ' - ' + destination,geometryJson]
      );
      routeId=inserted.rows[0].id;
      created+=1;
    }

    await client.query(
      `INSERT INTO source_record
        (source_id,entity_type,entity_id,external_record_id,source_payload,source_geometry,source_last_checked_at)
       VALUES
        ($1,'taxi_route',$2,$3,$4::jsonb,ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($5),4326)),now())
       ON CONFLICT (source_id,entity_type,external_record_id) DO UPDATE SET
         entity_id=excluded.entity_id,
         source_payload=excluded.source_payload,
         source_geometry=excluded.source_geometry,
         source_last_checked_at=now(),
         source_retrieved_at=now()`,
      [sourceId,routeId,externalId,JSON.stringify(p),geometryJson]
    );
  }

  await client.query('COMMIT');

  const proof=await client.query(
    `SELECT
       count(*)::int AS routes,
       count(*) FILTER (WHERE geometry_status='official_geometry')::int AS official_geometry_routes
     FROM taxi_route`
  );

  console.log(JSON.stringify({
    event:'route_ingest_complete',
    sourceId:source.id,
    fetched:features.length,
    created,updated,quarantined,
    database:proof.rows[0]
  }));
}catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  console.error(JSON.stringify({event:'route_ingest_failed',error:String(error?.message || error)}));
  process.exitCode=1;
}finally{
  client.release();
  await pool.end();
}
