import pg from 'pg';

const { Pool }=pg;
if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const source={
  id:'ekurhuleni-taxi-ranks-full',
  name:'City of Ekurhuleni Taxi Ranks',
  authority:'City of Ekurhuleni',
  url:'https://gis.ekurhuleni.gov.za/arcgis/rest/services/GMS/GMS/MapServer/128',
  province:'Gauteng',
  municipality:'City of Ekurhuleni'
};

const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3,ssl:false});

async function fetchJson(url,timeoutMs=60000){
  const response=await fetch(url,{
    headers:{'user-agent':'TenderizeTransportNetwork/1.0 ekurhuleni-full-rank-ingest'},
    signal:AbortSignal.timeout(timeoutMs)
  });
  if(!response.ok) throw new Error('Ekurhuleni GIS HTTP '+response.status+' '+response.statusText);
  const body=await response.json();
  if(body?.error) throw new Error('ArcGIS '+body.error.code+': '+body.error.message);
  return body;
}

async function fetchIds(){
  const qs=new URLSearchParams({where:'1=1',returnIdsOnly:'true',f:'json'});
  const body=await fetchJson(source.url+'/query?'+qs,120000);
  if(!Array.isArray(body.objectIds) || body.objectIds.length===0){
    throw new Error('Fail closed: Ekurhuleni source returned no object IDs');
  }
  return body.objectIds.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
}

async function fetchBatch(ids){
  const qs=new URLSearchParams({
    objectIds:ids.join(','),
    outFields:'*',
    returnGeometry:'true',
    outSR:'4326',
    f:'json'
  });
  const body=await fetchJson(source.url+'/query?'+qs,120000);
  if(!Array.isArray(body.features)) throw new Error('Ekurhuleni source returned no features array');
  return body.features;
}

function clean(v){ return typeof v==='string' ? v.trim() || null : v ?? null; }
function normalizeLabel(v){
  return String(v || '').trim().toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}

function normalize(feature){
  const a=feature.attributes || {};
  const geometry=feature.geometry || {};
  const lng=Number(
    a.LONGITUDE ?? a.longitude ?? a.LONGITUDE_ ?? a.long_ ?? geometry.x
  );
  const lat=Number(
    a.LATITUDE ?? a.latitude ?? a.LATTITUDE_ ?? a.lat ?? geometry.y
  );
  const associationLabels=Object.entries(a)
    .filter(([key,value])=>/^ASSOCIAT/i.test(key) && clean(value))
    .map(([,value])=>clean(value))
    .filter(Boolean);

  return {
    externalId:String(a.OBJECTID ?? a.FID ?? feature.id ?? '').trim(),
    name:clean(a.NAME ?? a.TAXI_FACIL ?? a.NAMEOF_FACILITY ?? a.ENTITY_NAME),
    region:clean(a.REGION ?? a.NEW_REGION),
    suburb:clean(a.SUBURB ?? a.A_SUBURB),
    town:clean(a.TOWN ?? a.A_TOWN),
    type:clean(a.TYPE ?? a.TYPE_1 ?? a.SANS_FTYPE),
    ownership:clean(a.OWNERSHIP ?? a.OWNER),
    numberOf:a.NUMBER_OF ?? null,
    longitude:lng,
    latitude:lat,
    associationLabels:[...new Set(associationLabels)],
    payload:a
  };
}

function valid(record){
  return record.externalId &&
    record.name &&
    Number.isFinite(record.longitude) &&
    Number.isFinite(record.latitude) &&
    record.longitude>=27 && record.longitude<=30 &&
    record.latitude>=-27.5 && record.latitude<=-25;
}

async function uniqueCanonicalMatch(client,record){
  const result=await client.query(
    `SELECT
       id::text,
       canonical_name,
       CASE WHEN location IS NULL THEN NULL
            ELSE ST_DistanceSphere(location,ST_SetSRID(ST_MakePoint($2,$3),4326))
       END AS distance_m
     FROM taxi_rank
     WHERE upper(trim(canonical_name))=upper(trim($1))
       AND province='Gauteng'
     ORDER BY distance_m NULLS LAST,id
     LIMIT 3`,
    [record.name,record.longitude,record.latitude]
  );

  const nearby=result.rows.filter(row=>row.distance_m!==null && Number(row.distance_m)<=150);
  return nearby.length===1 ? nearby[0].id : null;
}

const client=await pool.connect();

try{
  const schema=await client.query(
    "select to_regclass('public.taxi_rank') rank_table, to_regclass('public.source_record') source_record_table, to_regclass('public.rank_association_candidate') candidate_table"
  );
  if(!schema.rows[0].rank_table || !schema.rows[0].source_record_table || !schema.rows[0].candidate_table){
    throw new Error('Required transport schema is not present');
  }

  const ids=await fetchIds();
  const features=[];
  for(let i=0;i<ids.length;i+=100){
    const batch=ids.slice(i,i+100);
    const rows=await fetchBatch(batch);
    features.push(...rows);
    console.log(JSON.stringify({event:'ekurhuleni_rank_batch',start:i,requested:batch.length,returned:rows.length,total:ids.length}));
  }

  if(features.length!==ids.length){
    throw new Error('Fail closed: Ekurhuleni feature count mismatch expected='+ids.length+' returned='+features.length);
  }

  const records=features.map(normalize);
  const good=records.filter(valid);
  const bad=records.filter(record=>!valid(record));
  if(good.length===0) throw new Error('Fail closed: Ekurhuleni source returned zero valid ranks');

  await client.query('BEGIN');

  const registry=await client.query(
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
  const sourceId=registry.rows[0].id;

  let created=0,reused=0,updated=0,candidates=0,quarantined=0;

  for(const record of good){
    const sourceExisting=await client.query(
      `SELECT entity_id::text FROM source_record
       WHERE source_id=$1 AND entity_type='taxi_rank' AND external_record_id=$2`,
      [sourceId,record.externalId]
    );

    let rankId=sourceExisting.rows[0]?.entity_id || null;

    if(!rankId){
      rankId=await uniqueCanonicalMatch(client,record);
      if(rankId) reused+=1;
    }

    if(rankId){
      await client.query(
        `UPDATE taxi_rank SET
           canonical_name=$2,
           province=$3,
           municipality=$4,
           town=$5,
           region=$6,
           rank_type=coalesce($7,rank_type),
           location=ST_SetSRID(ST_MakePoint($8,$9),4326),
           verification_status='official',
           last_verified_at=now(),
           updated_at=now()
         WHERE id=$1::uuid`,
        [rankId,record.name,source.province,source.municipality,record.town,record.region,record.type,record.longitude,record.latitude]
      );
      updated+=1;
    }else{
      const inserted=await client.query(
        `INSERT INTO taxi_rank
          (canonical_name,province,municipality,town,region,rank_type,location,verification_status,last_verified_at)
         VALUES ($1,$2,$3,$4,$5,$6,ST_SetSRID(ST_MakePoint($7,$8),4326),'official',now())
         RETURNING id::text`,
        [record.name,source.province,source.municipality,record.town,record.region,record.type,record.longitude,record.latitude]
      );
      rankId=inserted.rows[0].id;
      created+=1;
    }

    await client.query(
      `INSERT INTO source_record
        (source_id,entity_type,entity_id,external_record_id,source_payload,source_geometry,source_last_checked_at,source_confidence)
       VALUES ($1,'taxi_rank',$2::uuid,$3,$4::jsonb,ST_SetSRID(ST_MakePoint($5,$6),4326),now(),1.0)
       ON CONFLICT (source_id,entity_type,external_record_id) DO UPDATE SET
         entity_id=excluded.entity_id,
         source_payload=excluded.source_payload,
         source_geometry=excluded.source_geometry,
         source_last_checked_at=now(),
         source_retrieved_at=now(),
         source_confidence=1.0`,
      [sourceId,rankId,record.externalId,JSON.stringify(record.payload),record.longitude,record.latitude]
    );

    for(const associationLabel of record.associationLabels){
      const normalized=normalizeLabel(associationLabel);
      if(!normalized) continue;
      await client.query(
        `INSERT INTO rank_association_candidate
          (source_id,source_rank_external_id,taxi_rank_id,association_label,normalized_label,verification_status)
         VALUES ($1,$2,$3::uuid,$4,$5,'documented')
         ON CONFLICT (source_id,source_rank_external_id,normalized_label) DO UPDATE SET
           taxi_rank_id=excluded.taxi_rank_id,
           association_label=excluded.association_label,
           last_seen_at=now()`,
        [sourceId,record.externalId,rankId,associationLabel,normalized]
      );
      candidates+=1;
    }
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
        'Ekurhuleni taxi-rank source record quarantined due to missing/invalid name or coordinates',
        JSON.stringify({issueKey,sourceKey:source.id,externalRecordId:record.externalId || null,name:record.name,longitude:Number.isFinite(record.longitude)?record.longitude:null,latitude:Number.isFinite(record.latitude)?record.latitude:null}),
        issueKey
      ]
    );
  }

  await client.query('COMMIT');

  const proof=await client.query(
    `SELECT
       (SELECT count(*)::int FROM taxi_rank) total_ranks,
       (SELECT count(*)::int FROM taxi_rank WHERE municipality=$1) ekurhuleni_ranks,
       (SELECT count(*)::int FROM rank_association_candidate rac JOIN source_registry s ON s.id=rac.source_id WHERE s.source_key=$2) association_candidates`,
    [source.municipality,source.id]
  );

  console.log(JSON.stringify({
    event:'ekurhuleni_full_rank_ingest_complete',
    objectIds:ids.length,
    fetched:features.length,
    valid:good.length,
    quarantined,
    created,
    reused,
    updated,
    associationCandidates:candidates,
    database:proof.rows[0]
  }));
}catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  console.error(JSON.stringify({event:'ekurhuleni_full_rank_ingest_failed',error:String(error?.message || error)}));
  process.exitCode=1;
}finally{
  client.release();
  await pool.end();
}
