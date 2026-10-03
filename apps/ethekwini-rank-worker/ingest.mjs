import https from 'node:https';
import pg from 'pg';

const { Pool }=pg;
if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const source={
  id:'ethekwini-bus-taxi-ranks-degraded',
  name:'eThekwini Bus/Taxi Ranks',
  authority:'eThekwini Municipality',
  url:'https://gis.durban.gov.za/server/rest/services/WebViewers/Social_Services_Publisher/MapServer/28',
  province:'KwaZulu-Natal',
  municipality:'eThekwini Metropolitan Municipality'
};

const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3,ssl:false});

function getJson(url){
  return new Promise((resolve,reject)=>{
    const req=https.get(url,{
      rejectUnauthorized:false,
      headers:{'user-agent':'TenderizeTransportNetwork/0.6 ethekwini-rank-ingest'}
    },res=>{
      let body='';
      res.setEncoding('utf8');
      res.on('data',chunk=>body+=chunk);
      res.on('end',()=>{
        if(res.statusCode<200 || res.statusCode>=300){
          reject(new Error('eThekwini GIS HTTP ' + res.statusCode));
          return;
        }
        try{
          const json=JSON.parse(body);
          if(json?.error) reject(new Error('ArcGIS ' + json.error.code + ': ' + json.error.message));
          else resolve(json);
        }catch(error){
          reject(new Error('Invalid eThekwini GIS JSON: ' + error.message));
        }
      });
    });
    req.setTimeout(30000,()=>req.destroy(new Error('eThekwini GIS timeout')));
    req.on('error',reject);
  });
}

async function fetchAll(){
  const countUrl=source.url + '/query?' + new URLSearchParams({
    where:'1=1',returnCountOnly:'true',f:'json'
  });
  const dataUrl=source.url + '/query?' + new URLSearchParams({
    where:'1=1',
    outFields:'*',
    returnGeometry:'true',
    outSR:'4326',
    resultOffset:'0',
    resultRecordCount:'1000',
    f:'json'
  });

  const [countPayload,dataPayload]=await Promise.all([getJson(countUrl),getJson(dataUrl)]);
  const expected=Number(countPayload.count);
  const features=Array.isArray(dataPayload.features) ? dataPayload.features : [];
  if(!Number.isFinite(expected) || expected<=0) throw new Error('Fail closed: invalid eThekwini source count');
  if(features.length!==expected){
    throw new Error('Fail closed: eThekwini count mismatch expected=' + expected + ' returned=' + features.length);
  }
  return {expected,features};
}

function clean(v){ return typeof v==='string' ? v.trim() || null : v ?? null; }
function normaliseLabel(v){
  return String(v || '').trim().toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}

function normalise(feature){
  const a=feature.attributes || {};
  return {
    externalId:String(a.OBJECTID ?? '').trim(),
    name:clean(a.NAME),
    type:clean(a.TYPE),
    routeDescriptor:clean(a.ROUTE),
    associationLabel:clean(a.CONTR_NAME),
    contactName:clean(a.CONTACT_NA),
    contactNumber:clean(a.CONTACT_NO),
    sourceDate:Number.isFinite(Number(a.DATE_)) ? Number(a.DATE_) : null,
    longitude:Number(feature.geometry?.x),
    latitude:Number(feature.geometry?.y),
    payload:a
  };
}

function validTaxi(r){
  return r.externalId &&
    r.name &&
    String(r.type || '').toLowerCase()==='taxi' &&
    Number.isFinite(r.longitude) &&
    Number.isFinite(r.latitude) &&
    r.longitude>=29 && r.longitude<=32 &&
    r.latitude>=-31 && r.latitude<=-29;
}

async function addIssue(client,{issueType,summary,detail}){
  await client.query(
    `INSERT INTO data_issue
      (entity_type,issue_type,severity,summary,detail,status)
     SELECT 'source',$1,'warning',$2,$3::jsonb,'open'
     WHERE NOT EXISTS (
       SELECT 1 FROM data_issue
       WHERE issue_type=$1
         AND detail->>'sourceKey'=$4
         AND status IN ('open','reviewing','deferred')
     )`,
    [issueType,summary,JSON.stringify(detail),source.id]
  );
}

const client=await pool.connect();

try{
  const schema=await client.query(
    "select to_regclass('public.taxi_rank') rank_table, to_regclass('public.source_record') source_table, to_regclass('public.rank_association_candidate') candidate_table, to_regclass('public.data_issue') issue_table"
  );
  const s=schema.rows[0];
  if(!s.rank_table || !s.source_table || !s.candidate_table || !s.issue_table){
    throw new Error('Required transport schema is not present');
  }

  const {expected,features}=await fetchAll();
  const all=features.map(normalise);
  const taxis=all.filter(validTaxi);
  const busCount=all.filter(r=>String(r.type || '').toLowerCase()==='bus').length;
  const invalidTaxiCount=all.filter(r=>String(r.type || '').toLowerCase()==='taxi' && !validTaxi(r)).length;

  if(taxis.length===0) throw new Error('Fail closed: eThekwini source returned zero valid taxi ranks');

  const sourceDates=taxis.map(r=>r.sourceDate).filter(Number.isFinite);
  const newestSourceDate=sourceDates.length ? Math.max(...sourceDates) : null;

  await client.query('BEGIN');

  const sourceRow=await client.query(
    `INSERT INTO source_registry
      (source_key,source_name,authority,source_class,source_url,coverage,licence_note,official,legacy,last_checked_at)
     VALUES ($1,$2,$3,'official_gis',$4,$5,$6,true,false,now())
     ON CONFLICT (source_key) DO UPDATE SET
       source_name=excluded.source_name,authority=excluded.authority,
       source_url=excluded.source_url,coverage=excluded.coverage,
       licence_note=excluded.licence_note,official=true,last_checked_at=now(),updated_at=now()
     RETURNING id`,
    [
      source.id,source.name,source.authority,source.url,
      'eThekwini, KwaZulu-Natal',
      'Official municipal GIS source. TLS chain verification failed in Railway and source records are dated circa 2012; records are treated as documented pending fresh verification.'
    ]
  );
  const sourceId=sourceRow.rows[0].id;

  await addIssue(client,{
    issueType:'source_tls_degraded',
    summary:'eThekwini municipal GIS requires source-specific TLS verification bypass',
    detail:{
      sourceKey:source.id,sourceUrl:source.url,authority:source.authority,
      reason:'certificate_chain_verification_failed',verificationStatus:'documented'
    }
  });

  if(newestSourceDate && newestSourceDate < Date.now() - 730*24*60*60*1000){
    await addIssue(client,{
      issueType:'source_stale_dataset',
      summary:'eThekwini Bus/Taxi Ranks source data is materially stale',
      detail:{
        sourceKey:source.id,
        sourceUrl:source.url,
        newestSourceDate:new Date(newestSourceDate).toISOString(),
        policy:'retain_as_documented_pending_refresh'
      }
    });
  }

  let created=0,updated=0,candidates=0;

  for(const record of taxis){
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
           canonical_name=$2,province=$3,municipality=$4,address=$5,
           rank_type='taxi_rank',
           location=ST_SetSRID(ST_MakePoint($6,$7),4326),
           verification_status='documented',last_verified_at=now(),updated_at=now()
         WHERE id=$1`,
        [rankId,record.name,source.province,source.municipality,record.routeDescriptor,record.longitude,record.latitude]
      );
      updated+=1;
    }else{
      const inserted=await client.query(
        `INSERT INTO taxi_rank
          (canonical_name,province,municipality,address,rank_type,location,verification_status,last_verified_at)
         VALUES ($1,$2,$3,$4,'taxi_rank',ST_SetSRID(ST_MakePoint($5,$6),4326),'documented',now())
         RETURNING id`,
        [record.name,source.province,source.municipality,record.routeDescriptor,record.longitude,record.latitude]
      );
      rankId=inserted.rows[0].id;
      created+=1;
    }

    await client.query(
      `INSERT INTO source_record
        (source_id,entity_type,entity_id,external_record_id,source_payload,source_geometry,source_last_checked_at)
       VALUES ($1,'taxi_rank',$2,$3,$4::jsonb,ST_SetSRID(ST_MakePoint($5,$6),4326),now())
       ON CONFLICT (source_id,entity_type,external_record_id) DO UPDATE SET
         entity_id=excluded.entity_id,source_payload=excluded.source_payload,
         source_geometry=excluded.source_geometry,source_last_checked_at=now(),source_retrieved_at=now()`,
      [sourceId,rankId,record.externalId,JSON.stringify(record.payload),record.longitude,record.latitude]
    );

    if(record.associationLabel){
      const normalized=normaliseLabel(record.associationLabel);
      if(normalized){
        await client.query(
          `INSERT INTO rank_association_candidate
            (source_id,source_rank_external_id,taxi_rank_id,association_label,normalized_label,verification_status)
           VALUES ($1,$2,$3,$4,$5,'documented')
           ON CONFLICT (source_id,source_rank_external_id,normalized_label) DO UPDATE SET
             taxi_rank_id=excluded.taxi_rank_id,
             association_label=excluded.association_label,
             last_seen_at=now()`,
          [sourceId,record.externalId,rankId,record.associationLabel,normalized]
        );
        candidates+=1;
      }
    }
  }

  await client.query('COMMIT');

  const proof=await client.query(
    `SELECT
       (SELECT count(*)::int FROM taxi_rank) total_ranks,
       (SELECT count(*)::int FROM taxi_rank WHERE province='KwaZulu-Natal') kzn_ranks,
       (SELECT count(*)::int FROM taxi_rank WHERE municipality=$1) ethekwini_named_ranks,
       (SELECT count(*)::int FROM rank_association_candidate rac
        JOIN source_registry s ON s.id=rac.source_id WHERE s.source_key=$2) association_candidates,
       (SELECT count(*)::int FROM data_issue WHERE status IN ('open','reviewing','deferred')) open_issues`,
    [source.municipality,source.id]
  );

  console.log(JSON.stringify({
    event:'ethekwini_rank_ingest_complete',
    expected,
    fetched:features.length,
    taxiSourceRecords:taxis.length,
    busSourceRecords:busCount,
    invalidTaxiRecords:invalidTaxiCount,
    created,updated,associationCandidates:candidates,
    newestSourceDate:newestSourceDate ? new Date(newestSourceDate).toISOString() : null,
    database:proof.rows[0]
  }));
}catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  console.error(JSON.stringify({event:'ethekwini_rank_ingest_failed',error:String(error?.message || error)}));
  process.exitCode=1;
}finally{
  client.release();
  await pool.end();
}
