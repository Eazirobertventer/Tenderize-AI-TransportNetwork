import pg from 'pg';

const { Pool }=pg;
if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const source={
  id:'western-cape-ngi-taxi-ranks',
  name:'Western Cape NGI Road Transport Facilities - Taxi Ranks',
  authority:'National Geo-spatial Information / Western Cape Government',
  url:'https://gis.westerncape.gov.za/server2/rest/services/SpatialDataWarehouse/Transportation/MapServer/13',
  province:'Western Cape'
};

const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3,ssl:false});

async function fetchJson(url,timeoutMs=60000){
  const response=await fetch(url,{
    headers:{'user-agent':'TenderizeTransportNetwork/1.0 western-cape-rank-ingest'},
    signal:AbortSignal.timeout(timeoutMs)
  });
  if(!response.ok) throw new Error('Western Cape GIS HTTP '+response.status+' '+response.statusText);
  const body=await response.json();
  if(body?.error) throw new Error('ArcGIS '+body.error.code+': '+body.error.message);
  return body;
}

async function fetchIds(){
  const qs=new URLSearchParams({
    where:"FEAT_TYPE='Taxi Rank'",
    returnIdsOnly:'true',
    f:'json'
  });
  const body=await fetchJson(source.url+'/query?'+qs,30000);
  if(!Array.isArray(body.objectIds) || body.objectIds.length===0){
    throw new Error('Fail closed: Western Cape source returned no taxi-rank IDs');
  }
  return body.objectIds.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
}

async function fetchBatch(ids){
  const qs=new URLSearchParams({
    objectIds:ids.join(','),
    outFields:'OBJECTID,CUID,FEAT_TYPE,SUB_TYPE,OP_STATUS,CAP_SOURCE,CAP_METHOD,SOURCE_DESC,SOURCE_CURR,SOURCE_ACCU,ENTITY_NAME,REF_50K,REF_10K',
    returnGeometry:'true',
    outSR:'4326',
    f:'geojson'
  });
  const body=await fetchJson(source.url+'/query?'+qs,60000);
  if(!Array.isArray(body.features)) throw new Error('Western Cape source returned no features array');
  return body.features;
}

function clean(v){ return typeof v==='string' ? v.trim() || null : v ?? null; }

function normalize(feature){
  const p=feature.properties || {};
  return {
    externalId:String(p.OBJECTID ?? feature.id ?? '').trim(),
    cuid:clean(p.CUID),
    name:clean(p.ENTITY_NAME),
    subType:clean(p.SUB_TYPE),
    opStatus:clean(p.OP_STATUS),
    capSource:clean(p.CAP_SOURCE),
    capMethod:clean(p.CAP_METHOD),
    sourceDescription:clean(p.SOURCE_DESC),
    sourceAccuracy:Number.isFinite(Number(p.SOURCE_ACCU)) ? Number(p.SOURCE_ACCU) : null,
    sourceCurrent:Number.isFinite(Number(p.SOURCE_CURR)) ? new Date(Number(p.SOURCE_CURR)) : null,
    ref50k:clean(p.REF_50K),
    ref10k:clean(p.REF_10K),
    geometry:feature.geometry,
    payload:p
  };
}

function valid(record){
  return record.externalId &&
    record.name &&
    record.geometry &&
    ['Polygon','MultiPolygon'].includes(record.geometry.type);
}

const client=await pool.connect();

try{
  const schema=await client.query(
    "select to_regclass('public.taxi_rank') rank_table, to_regclass('public.source_record') source_record_table"
  );
  if(!schema.rows[0].rank_table || !schema.rows[0].source_record_table){
    throw new Error('Required transport schema is not present');
  }

  const ids=await fetchIds();
  const features=[];
  for(let i=0;i<ids.length;i+=100){
    const batch=ids.slice(i,i+100);
    const rows=await fetchBatch(batch);
    features.push(...rows);
    console.log(JSON.stringify({event:'western_cape_rank_batch',start:i,requested:batch.length,returned:rows.length,total:ids.length}));
  }

  if(features.length!==ids.length){
    throw new Error('Fail closed: Western Cape feature count mismatch expected='+ids.length+' returned='+features.length);
  }

  const records=features.map(normalize);
  const good=records.filter(valid);
  const bad=records.filter(record=>!valid(record));
  if(good.length===0){
    console.error(JSON.stringify({
      event:'western_cape_rank_validation_diagnostic',
      sample:records.slice(0,5).map(record=>({
        externalId:record.externalId,
        name:record.name,
        geometryType:record.geometry?.type || null,
        cuid:record.cuid,
        subType:record.subType,
        opStatus:record.opStatus
      }))
    }));
    throw new Error('Fail closed: Western Cape source returned zero valid taxi ranks');
  }

  await client.query('BEGIN');

  const registry=await client.query(
    `INSERT INTO source_registry
      (source_key,source_name,authority,source_class,source_url,coverage,licence_note,official,legacy,last_checked_at)
     VALUES ($1,$2,$3,'official_gis',$4,'Western Cape',$5,true,false,now())
     ON CONFLICT (source_key) DO UPDATE SET
       source_name=excluded.source_name,
       authority=excluded.authority,
       source_url=excluded.source_url,
       coverage=excluded.coverage,
       licence_note=excluded.licence_note,
       official=true,
       legacy=false,
       last_checked_at=now(),
       updated_at=now()
     RETURNING id`,
    [
      source.id,source.name,source.authority,source.url,
      'NGI transport-facility geometry; rank marker derived using point-on-surface of official polygon.'
    ]
  );
  const sourceId=registry.rows[0].id;

  let created=0,updated=0,quarantined=0;

  for(const record of good){
    const existing=await client.query(
      `SELECT entity_id::text FROM source_record
       WHERE source_id=$1 AND entity_type='taxi_rank' AND external_record_id=$2`,
      [sourceId,record.externalId]
    );

    const geometryJson=JSON.stringify(record.geometry);
    let rankId=existing.rows[0]?.entity_id || null;

    if(rankId){
      await client.query(
        `UPDATE taxi_rank SET
           canonical_name=$2,
           province=$3,
           location=ST_PointOnSurface(ST_SetSRID(ST_GeomFromGeoJSON($4),4326)),
           verification_status='official',
           last_verified_at=now(),
           updated_at=now()
         WHERE id=$1::uuid`,
        [rankId,record.name,source.province,geometryJson]
      );
      updated+=1;
    }else{
      const inserted=await client.query(
        `INSERT INTO taxi_rank
          (canonical_name,province,rank_type,location,verification_status,confidence,last_verified_at)
         VALUES
          ($1,$2,'taxi_rank',ST_PointOnSurface(ST_SetSRID(ST_GeomFromGeoJSON($3),4326)),'official',1.0,now())
         RETURNING id::text`,
        [record.name,source.province,geometryJson]
      );
      rankId=inserted.rows[0].id;
      created+=1;
    }

    await client.query(
      `INSERT INTO source_record
        (source_id,entity_type,entity_id,external_record_id,source_payload,source_geometry,source_last_checked_at,source_confidence)
       VALUES
        ($1,'taxi_rank',$2::uuid,$3,$4::jsonb,ST_SetSRID(ST_GeomFromGeoJSON($5),4326),now(),1.0)
       ON CONFLICT (source_id,entity_type,external_record_id) DO UPDATE SET
         entity_id=excluded.entity_id,
         source_payload=excluded.source_payload,
         source_geometry=excluded.source_geometry,
         source_last_checked_at=now(),
         source_retrieved_at=now(),
         source_confidence=1.0`,
      [sourceId,rankId,record.externalId,JSON.stringify({
        ...record.payload,
        cuid:record.cuid,
        sourceAccuracy:record.sourceAccuracy,
        sourceCurrent:record.sourceCurrent?.toISOString() || null,
        markerDerivation:'ST_PointOnSurface(official_polygon)'
      }),geometryJson]
    );
  }

  for(const record of bad){
    quarantined+=1;
    const issueKey=source.id+'|'+(record.externalId || 'missing-id');
    await client.query(
      `INSERT INTO data_issue
        (entity_type,issue_type,severity,summary,detail,status)
       SELECT 'taxi_rank_source','source_rank_quarantine','warning',$1,$2::jsonb,'open'
       WHERE NOT EXISTS (
         SELECT 1 FROM data_issue
         WHERE issue_type='source_rank_quarantine'
           AND detail->>'issueKey'=$3
           AND status IN ('open','reviewing','deferred')
       )`,
      [
        'Western Cape NGI taxi-rank feature quarantined due to missing name or unsupported geometry',
        JSON.stringify({issueKey,sourceKey:source.id,externalRecordId:record.externalId || null,name:record.name,geometryType:record.geometry?.type || null}),
        issueKey
      ]
    );
  }

  await client.query('COMMIT');

  const proof=await client.query(
    `SELECT
       (SELECT count(*)::int FROM taxi_rank) total_ranks,
       (SELECT count(*)::int FROM taxi_rank WHERE province='Western Cape') western_cape_ranks,
       (SELECT count(*)::int FROM source_record sr JOIN source_registry s ON s.id=sr.source_id WHERE s.source_key=$1 AND sr.entity_type='taxi_rank') source_records`,
    [source.id]
  );

  console.log(JSON.stringify({
    event:'western_cape_ngi_rank_ingest_complete',
    objectIds:ids.length,
    fetched:features.length,
    valid:good.length,
    quarantined,
    created,
    updated,
    database:proof.rows[0]
  }));
}catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  console.error(JSON.stringify({event:'western_cape_ngi_rank_ingest_failed',error:String(error?.message || error)}));
  process.exitCode=1;
}finally{
  client.release();
  await pool.end();
}
