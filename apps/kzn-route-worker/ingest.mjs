import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const { Pool }=pg;
if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const source={
  id:'kzn-dot-taxi-routes-2026',
  name:'KZN Department of Transport Taxi Routes',
  authority:'KwaZulu-Natal Department of Transport',
  url:'https://gis.kznpidh.gov.za/hosting/rest/services/Department_of_Transport__ff_MIL1/MapServer/3',
  province:'KwaZulu-Natal'
};

const root=resolve(new URL('.',import.meta.url).pathname);
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3,ssl:false});

async function ensureSchema(client){
  const current=await client.query("select to_regclass('public.source_route_geometry') table_name, to_regclass('public.source_registry') source_registry");
  if(!current.rows[0].source_registry) throw new Error('Required transport source registry schema is not present');
  if(!current.rows[0].table_name){
    const sql=await readFile(resolve(root,'schema.sql'),'utf8');
    await client.query(sql);
  }
}

async function fetchJson(url,timeoutMs=60000){
  const response=await fetch(url,{
    headers:{'user-agent':'TenderizeTransportNetwork/1.0 kzn-route-geometry-ingest'},
    signal:AbortSignal.timeout(timeoutMs)
  });
  if(!response.ok) throw new Error('KZN route GIS HTTP '+response.status+' '+response.statusText);
  const body=await response.json();
  if(body?.error) throw new Error('ArcGIS '+body.error.code+': '+body.error.message);
  return body;
}

async function fetchIds(){
  const qs=new URLSearchParams({where:'1=1',returnIdsOnly:'true',f:'json'});
  const body=await fetchJson(source.url+'/query?'+qs,30000);
  if(!Array.isArray(body.objectIds) || body.objectIds.length===0){
    throw new Error('Fail closed: KZN route source returned no object IDs');
  }
  return body.objectIds.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
}

async function fetchBatch(ids){
  const qs=new URLSearchParams({
    objectIds:ids.join(','),
    outFields:'OBJECTID_12_13,OBJECTID,ID,KZNBRCD,PROVINCE,CATEGORY,CAT2,CAT_B,MUNICNAME,NAMECODE,MAP_TITLE,DISTRICT,DISTRICT_N,DATE',
    returnGeometry:'true',
    outSR:'4326',
    f:'geojson'
  });
  const body=await fetchJson(source.url+'/query?'+qs,60000);
  if(!Array.isArray(body.features)) throw new Error('KZN route source returned no features array');
  return body.features;
}

function clean(v){ return typeof v==='string' ? v.trim() || null : v ?? null; }

function externalId(feature){
  const p=feature.properties || {};
  return String(p.OBJECTID_12_13 ?? p.OBJECTID ?? p.ID ?? feature.id ?? '').trim();
}

function normalizeGeometry(g){
  if(!g) return null;
  if(g.type==='MultiLineString') return g;
  if(g.type==='LineString') return {type:'MultiLineString',coordinates:[g.coordinates]};
  return null;
}

const client=await pool.connect();

try{
  await ensureSchema(client);

  const ids=await fetchIds();
  const features=[];
  for(let i=0;i<ids.length;i+=100){
    const batch=ids.slice(i,i+100);
    const rows=await fetchBatch(batch);
    features.push(...rows);
    console.log(JSON.stringify({event:'kzn_route_geometry_batch',start:i,requested:batch.length,returned:rows.length,total:ids.length}));
  }

  if(features.length!==ids.length){
    throw new Error('Fail closed: KZN route feature count mismatch expected='+ids.length+' returned='+features.length);
  }

  await client.query('BEGIN');

  const sr=await client.query(
    `INSERT INTO source_registry
      (source_key,source_name,authority,source_class,source_url,coverage,official,legacy,last_checked_at)
     VALUES ($1,$2,$3,'official_gis',$4,'KwaZulu-Natal',true,false,now())
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
    [source.id,source.name,source.authority,source.url]
  );
  const sourceId=sr.rows[0].id;

  let created=0,updated=0,quarantined=0;

  for(const feature of features){
    const p=feature.properties || {};
    const id=externalId(feature);
    const geometry=normalizeGeometry(feature.geometry);

    if(!id || !geometry){
      quarantined+=1;
      const key='kzn-route-geometry|'+(id || 'missing-id')+'|'+String(p.KZNBRCD ?? '');
      await client.query(
        `INSERT INTO data_issue
          (entity_type,issue_type,severity,summary,detail,status)
         SELECT 'taxi_route_source','source_route_geometry_quarantine','warning',$1,$2::jsonb,'open'
         WHERE NOT EXISTS (
           SELECT 1 FROM data_issue
           WHERE issue_type='source_route_geometry_quarantine'
             AND detail->>'issueKey'=$3
             AND status IN ('open','reviewing','deferred')
         )`,
        [
          'KZN official route geometry quarantined due to missing ID or unsupported geometry',
          JSON.stringify({issueKey:key,sourceKey:source.id,externalRecordId:id || null,geometryType:feature.geometry?.type || null}),
          key
        ]
      );
      continue;
    }

    const existing=await client.query(
      `SELECT id FROM source_route_geometry WHERE source_id=$1 AND external_record_id=$2`,
      [sourceId,id]
    );

    const routeCode=clean(p.KZNBRCD) || clean(p.NAMECODE) || clean(p.MAP_TITLE);
    const municipality=clean(p.MUNICNAME);
    const district=clean(p.DISTRICT_N) || clean(p.DISTRICT);
    const category=clean(p.CATEGORY) || clean(p.CAT2) || clean(p.CAT_B);
    const sourceDate=Number.isFinite(Number(p.DATE)) ? new Date(Number(p.DATE)) : null;
    const geometryJson=JSON.stringify(geometry);

    if(existing.rows.length){
      await client.query(
        `UPDATE source_route_geometry SET
           route_code=$3,
           province=$4,
           municipality=$5,
           district=$6,
           category=$7,
           map_title=$8,
           geometry=ST_SetSRID(ST_GeomFromGeoJSON($9),4326),
           verification_status='documented',
           source_date=$10,
           source_payload=$11::jsonb,
           last_seen_at=now()
         WHERE source_id=$1 AND external_record_id=$2`,
        [sourceId,id,routeCode,source.province,municipality,district,category,clean(p.MAP_TITLE),geometryJson,sourceDate,JSON.stringify(p)]
      );
      updated+=1;
    }else{
      await client.query(
        `INSERT INTO source_route_geometry
          (source_id,external_record_id,route_code,province,municipality,district,category,map_title,geometry,verification_status,source_date,source_payload)
         VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,ST_SetSRID(ST_GeomFromGeoJSON($9),4326),'documented',$10,$11::jsonb)`,
        [sourceId,id,routeCode,source.province,municipality,district,category,clean(p.MAP_TITLE),geometryJson,sourceDate,JSON.stringify(p)]
      );
      created+=1;
    }
  }

  await client.query('COMMIT');

  const proof=await client.query(
    `SELECT
       count(*)::int total,
       count(*) FILTER (WHERE verification_status='documented')::int documented,
       count(*) FILTER (WHERE promoted_route_id IS NOT NULL)::int promoted
     FROM source_route_geometry
     WHERE source_id=$1`,
    [sourceId]
  );

  console.log(JSON.stringify({
    event:'kzn_route_geometry_ingest_complete',
    objectIds:ids.length,
    fetched:features.length,
    created,
    updated,
    quarantined,
    database:proof.rows[0]
  }));
}catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  console.error(JSON.stringify({event:'kzn_route_geometry_ingest_failed',error:String(error?.message || error)}));
  process.exitCode=1;
}finally{
  client.release();
  await pool.end();
}
