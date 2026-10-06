import https from 'node:https';
import pg from 'pg';

const { Pool }=pg;
if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const source={
  id:'kzn-taxi-ranks-degraded-tls',
  name:'KZN Department of Transport Taxi Ranks',
  authority:'KwaZulu-Natal Department of Transport',
  url:'https://gis1.kzntransport.gov.za/arcgisserver/rest/services/KZN_Schools_Health_Facilities/MapServer/6',
  province:'KwaZulu-Natal'
};

const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3,ssl:false});

function getJson(url){
  return new Promise((resolve,reject)=>{
    const req=https.get(url,{
      rejectUnauthorized:false,
      headers:{'user-agent':'TenderizeTransportNetwork/0.5 kzn-rank-ingest'}
    },res=>{
      let body='';
      res.setEncoding('utf8');
      res.on('data',chunk=>body+=chunk);
      res.on('end',()=>{
        if(res.statusCode<200 || res.statusCode>=300){
          reject(new Error('KZN GIS HTTP ' + res.statusCode));
          return;
        }
        try{
          const json=JSON.parse(body);
          if(json?.error) reject(new Error('ArcGIS ' + json.error.code + ': ' + json.error.message));
          else resolve(json);
        }catch(error){
          reject(new Error('Invalid KZN GIS JSON: ' + error.message));
        }
      });
    });
    req.setTimeout(30000,()=>req.destroy(new Error('KZN GIS timeout')));
    req.on('error',reject);
  });
}

async function fetchRanks(){
  const countUrl=source.url + '/query?' + new URLSearchParams({
    where:'1=1',
    returnCountOnly:'true',
    f:'json'
  });
  const dataUrl=source.url + '/query?' + new URLSearchParams({
    where:'1=1',
    outFields:'*',
    returnGeometry:'true',
    outSR:'4326',
    f:'json'
  });

  const [countPayload,dataPayload]=await Promise.all([getJson(countUrl),getJson(dataUrl)]);
  const expected=Number(countPayload.count);
  const features=Array.isArray(dataPayload.features) ? dataPayload.features : [];

  if(!Number.isFinite(expected) || expected<=0) throw new Error('Fail closed: invalid KZN source count');
  if(features.length!==expected){
    throw new Error('Fail closed: KZN source count mismatch expected=' + expected + ' returned=' + features.length);
  }
  return {expected,features};
}

function normalise(feature){
  const a=feature.attributes || {};
  const geometry=feature.geometry || {};
  return {
    externalId:String(a.OBJECTID ?? '').trim(),
    rankCode:String(a.RANK_CODE ?? '').trim(),
    snapped:a.SNAPPED ?? null,
    snapDistance:a.SNAP_DIST ?? null,
    longitude:Number(geometry.x),
    latitude:Number(geometry.y),
    payload:a
  };
}

function valid(r){
  return r.externalId &&
    r.rankCode &&
    Number.isFinite(r.longitude) &&
    Number.isFinite(r.latitude) &&
    r.longitude>=27 && r.longitude<=34 &&
    r.latitude>=-32 && r.latitude<=-26;
}

async function addSourceIssue(client){
  const detail={
    sourceKey:source.id,
    sourceUrl:source.url,
    authority:source.authority,
    reason:'expired_tls_certificate',
    certificateExpired:'2026-05-11',
    ingestionPolicy:'source_specific_tls_exception',
    verificationStatus:'documented'
  };
  await client.query(
    `INSERT INTO data_issue
      (entity_type,issue_type,severity,summary,detail,status)
     SELECT 'source','source_tls_degraded','warning',$1,$2::jsonb,'open'
     WHERE NOT EXISTS (
       SELECT 1 FROM data_issue
       WHERE issue_type='source_tls_degraded'
         AND detail->>'sourceKey'=$3
         AND status IN ('open','reviewing','deferred')
     )`,
    [
      'KZN official GIS source has an expired TLS certificate; records are documented, not fully verified',
      JSON.stringify(detail),
      source.id
    ]
  );
}

const client=await pool.connect();

try{
  const schema=await client.query(
    "select to_regclass('public.taxi_rank') as rank_table, to_regclass('public.source_record') as source_table, to_regclass('public.data_issue') as issue_table"
  );
  if(!schema.rows[0].rank_table || !schema.rows[0].source_table || !schema.rows[0].issue_table){
    throw new Error('Required transport schema is not present');
  }

  const {expected,features}=await fetchRanks();
  const records=features.map(normalise);
  const good=records.filter(valid);
  const bad=records.filter(r=>!valid(r));

  if(good.length===0) throw new Error('Fail closed: KZN source returned zero valid ranks');

  await client.query('BEGIN');

  const sourceRow=await client.query(
    `INSERT INTO source_registry
      (source_key,source_name,authority,source_class,source_url,coverage,licence_note,official,legacy,last_checked_at)
     VALUES ($1,$2,$3,'official_gis',$4,$5,$6,true,false,now())
     ON CONFLICT (source_key) DO UPDATE SET
       source_name=excluded.source_name,
       authority=excluded.authority,
       source_url=excluded.source_url,
       coverage=excluded.coverage,
       licence_note=excluded.licence_note,
       official=true,
       last_checked_at=now(),
       updated_at=now()
     RETURNING id`,
    [
      source.id,
      source.name,
      source.authority,
      source.url,
      'KwaZulu-Natal',
      'Official GIS source; TLS certificate expired 2026-05-11. Source-specific TLS exception used. Canonical records remain documented.'
    ]
  );
  const sourceId=sourceRow.rows[0].id;

  await addSourceIssue(client);

  let created=0,updated=0;

  for(const record of good){
    const existing=await client.query(
      `SELECT entity_id FROM source_record
       WHERE source_id=$1 AND entity_type='taxi_rank' AND external_record_id=$2`,
      [sourceId,record.externalId]
    );

    let rankId;
    if(existing.rows[0]?.entity_id){
      rankId=existing.rows[0].entity_id;
      await client.query(
        `UPDATE taxi_rank SET
           canonical_name=$2,
           province=$3,
           rank_type='coded_rank',
           location=ST_SetSRID(ST_MakePoint($4,$5),4326),
           verification_status='documented',
           last_verified_at=now(),
           updated_at=now()
         WHERE id=$1`,
        [rankId,record.rankCode,source.province,record.longitude,record.latitude]
      );
      updated+=1;
    }else{
      const inserted=await client.query(
        `INSERT INTO taxi_rank
          (canonical_name,province,rank_type,location,verification_status,last_verified_at)
         VALUES ($1,$2,'coded_rank',ST_SetSRID(ST_MakePoint($3,$4),4326),'documented',now())
         RETURNING id`,
        [record.rankCode,source.province,record.longitude,record.latitude]
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
      [
        sourceId,
        rankId,
        record.externalId,
        JSON.stringify({
          ...record.payload,
          sourceTlsDegraded:true,
          snapped:record.snapped,
          snapDistance:record.snapDistance
        }),
        record.longitude,
        record.latitude
      ]
    );
  }

  for(const record of bad){
    const detail={
      sourceKey:source.id,
      externalRecordId:record.externalId || null,
      rankCode:record.rankCode || null,
      longitude:Number.isFinite(record.longitude)?record.longitude:null,
      latitude:Number.isFinite(record.latitude)?record.latitude:null
    };
    await client.query(
      `INSERT INTO data_issue
        (entity_type,issue_type,severity,summary,detail,status)
       SELECT 'taxi_rank_source','source_rank_quarantine','warning',$1,$2::jsonb,'open'
       WHERE NOT EXISTS (
         SELECT 1 FROM data_issue
         WHERE issue_type='source_rank_quarantine'
           AND detail->>'sourceKey'=$3
           AND detail->>'externalRecordId'=$4
           AND status IN ('open','reviewing','deferred')
       )`,
      [
        'KZN taxi rank source record quarantined due to missing/invalid code or coordinates',
        JSON.stringify(detail),
        source.id,
        record.externalId || ''
      ]
    );
  }

  await client.query('COMMIT');

  const proof=await client.query(
    `SELECT
       (SELECT count(*)::int FROM taxi_rank) AS total_ranks,
       (SELECT count(*)::int FROM taxi_rank WHERE province='KwaZulu-Natal') AS kzn_ranks,
       (SELECT count(*)::int FROM taxi_rank WHERE province='KwaZulu-Natal' AND verification_status='documented') AS kzn_documented,
       (SELECT count(*)::int FROM data_issue WHERE status IN ('open','reviewing','deferred')) AS open_issues`
  );

  console.log(JSON.stringify({
    event:'kzn_rank_ingest_complete',
    sourceId:source.id,
    expected,
    fetched:features.length,
    valid:good.length,
    quarantined:bad.length,
    created,
    updated,
    database:proof.rows[0]
  }));
}catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  console.error(JSON.stringify({event:'kzn_rank_ingest_failed',error:String(error?.message || error)}));
  process.exitCode=1;
}finally{
  client.release();
  await pool.end();
}
