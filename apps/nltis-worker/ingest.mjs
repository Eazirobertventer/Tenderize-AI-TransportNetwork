import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const { Pool } = pg;
if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const root=resolve(new URL('.',import.meta.url).pathname);
const allSources=JSON.parse(await readFile(resolve(root,'sources.json'),'utf8'));
const requestedSourceIds=(process.env.NLTIS_SOURCE_IDS || '')
  .split(',')
  .map(value=>value.trim())
  .filter(Boolean);
const sources=requestedSourceIds.length
  ? allSources.filter(source=>requestedSourceIds.includes(source.id))
  : allSources;

if(requestedSourceIds.length && sources.length!==requestedSourceIds.length){
  const found=new Set(sources.map(source=>source.id));
  const missing=requestedSourceIds.filter(id=>!found.has(id));
  throw new Error('Unknown NLTIS source IDs: ' + missing.join(','));
}

const verifiedSnapshots=new Map();

async function loadSnapshot(path){
  try{
    const snapshot=JSON.parse(await readFile(path,'utf8'));
    if(snapshot?.sourceId) verifiedSnapshots.set(snapshot.sourceId,snapshot);
  }catch(error){
    if(error?.code!=='ENOENT') throw error;
  }
}

await loadSnapshot(resolve(root,'verified-snapshot.json'));

try{
  const files=(await readdir(resolve(root,'verified-snapshots')))
    .filter(name=>name.endsWith('.json'))
    .sort();
  for(const name of files){
    await loadSnapshot(resolve(root,'verified-snapshots',name));
  }
}catch(error){
  if(error?.code!=='ENOENT') throw error;
}

const forceSnapshot=['1','true','yes'].includes(String(process.env.NLTIS_FORCE_SNAPSHOT || '').toLowerCase());
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3,ssl:false});

function decodeHtml(value=''){
  return value
    .replace(/<br\s*\/?\s*>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&nbsp;/gi,' ')
    .replace(/&#39;/g,"'")
    .replace(/&quot;/gi,'"')
    .replace(/\s+/g,' ')
    .trim();
}

function parseRoutes(html){
  const routes=[];
  for(const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)){
    const cells=[...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map(match=>decodeHtml(match[1]));
    if(cells.length<6) continue;

    const [sequence,streetDescription,routeName,nationalRouteCode,boardRouteCode,detail]=cells;
    if(!sequence || (!nationalRouteCode && !boardRouteCode)) continue;

    let origin=null;
    let destination=null;
    const match=detail.match(/^(.*?)\s*\(Origin\)\s*,\s*(.*?)\s*\(Destination\)/i);
    if(match){
      origin=match[1].trim();
      destination=match[2].trim();
    }else{
      const split=routeName.split(/\s+-\s+/);
      if(split.length>=2){
        origin=split[0].trim();
        destination=split.slice(1).join(' - ').trim();
      }
    }

    if(!origin || !destination) continue;

    routes.push({
      sequence:String(sequence).trim(),
      streetDescription,
      routeName,
      nationalRouteCode,
      boardRouteCode,
      detail,
      origin,
      destination
    });
  }
  return routes;
}

async function exactRankId(client,label){
  const result=await client.query(
    `SELECT id FROM taxi_rank
     WHERE upper(trim(canonical_name))=upper(trim($1))
     ORDER BY id
     LIMIT 2`,
    [label]
  );
  return result.rows.length===1 ? result.rows[0].id : null;
}

async function fetchText(url){
  const response=await fetch(url,{
    headers:{'user-agent':'TenderizeTransportNetwork/0.5 nltis-ingest'},
    signal:AbortSignal.timeout(30000)
  });
  if(!response.ok) throw new Error('NLTIS HTTP ' + response.status + ' ' + response.statusText);
  return response.text();
}

function validSnapshotForSource(snapshot,source){
  return Boolean(
    snapshot &&
    snapshot.sourceId===source.id &&
    snapshot.association?.registrationNumber===source.registrationNumber &&
    Array.isArray(snapshot.routes) &&
    snapshot.routes.length>0
  );
}

function routeExternalId(route){
  const sequence=String(route.sequence || '').trim();
  if(!sequence) throw new Error('NLTIS route is missing sequence');
  return 'route:seq:' + sequence.padStart(4,'0');
}

function legacyRouteExternalId(route){
  return 'route:' + (route.boardRouteCode || route.nationalRouteCode || route.sequence);
}

async function recordQuarantinedRows(client,{source,sourceUuid,associationId,snapshot}){
  const rows=Array.isArray(snapshot?.quarantinedRows)?snapshot.quarantinedRows:[];
  for(const row of rows){
    const issueKey=[source.id,'report-row',String(row.sequence),String(row.reason || '')].join('|');
    const detail={
      issueKey,
      sourceId:source.id,
      sourceKey:source.id,
      associationId,
      associationName:source.associationName,
      registrationNumber:source.registrationNumber,
      reportPrintedAt:snapshot.reportPrintedAt || null,
      reportRouteRowCount:snapshot.reportRouteRowCount || null,
      sequence:String(row.sequence),
      reason:row.reason || 'unstructured_report_row',
      autoMerge:false
    };

    await client.query(
      `INSERT INTO data_issue
        (entity_type,entity_id,issue_type,severity,summary,detail,status)
       SELECT
        'nltis_report_row',$1::uuid,'nltis_report_row_quarantined','warning',$2,$3::jsonb,'open'
       WHERE NOT EXISTS (
         SELECT 1 FROM data_issue
         WHERE issue_type='nltis_report_row_quarantined'
           AND detail->>'issueKey'=$4
           AND status IN ('open','reviewing','deferred')
       )`,
      [
        associationId,
        'NLTIS report row quarantined: ' + source.associationName + ' sequence ' + row.sequence,
        JSON.stringify(detail),
        issueKey
      ]
    );
  }
  return rows.length;
}

const client=await pool.connect();

try{
  const schema=await client.query(
    "select to_regclass('public.taxi_association') as association_table, to_regclass('public.taxi_route') as route_table"
  );
  if(!schema.rows[0].association_table || !schema.rows[0].route_table){
    throw new Error('Required transport schema is not present');
  }

  const summary=[];

  for(const source of sources){
    let routes=[];
    let acquisitionMode='live';
    let upstreamError=null;
    let snapshot=null;

    try{
      if(forceSnapshot) throw new Error('Snapshot forced by NLTIS_FORCE_SNAPSHOT');
      const html=await fetchText(source.url);
      routes=parseRoutes(html);
      if(routes.length===0) throw new Error('No NLTIS routes parsed');
    }catch(error){
      upstreamError=String(error?.message || error);
      snapshot=verifiedSnapshots.get(source.id);

      if(validSnapshotForSource(snapshot,source)){
        routes=snapshot.routes;
        acquisitionMode='verified_snapshot';
      }else{
        await client.query(
          `INSERT INTO data_issue
            (entity_type,issue_type,severity,summary,detail,status)
           SELECT 'nltis_source','source_acquisition_failed','warning',$1,$2::jsonb,'open'
           WHERE NOT EXISTS (
             SELECT 1 FROM data_issue
             WHERE issue_type='source_acquisition_failed'
               AND detail->>'sourceId'=$3
               AND status IN ('open','reviewing','deferred')
           )`,
          [
            'NLTIS source acquisition failed: ' + source.associationName,
            JSON.stringify({
              sourceId:source.id,
              associationName:source.associationName,
              registrationNumber:source.registrationNumber,
              url:source.url,
              error:upstreamError
            }),
            source.id
          ]
        );

        summary.push({
          sourceId:source.id,
          association:source.associationName,
          registrationNumber:source.registrationNumber,
          parsedRoutes:0,
          acquisitionMode:'unavailable',
          upstreamError,
          created:0,
          updated:0,
          exactRankLinks:0,
          quarantinedReportRows:0,
          skipped:true
        });
        continue;
      }
    }

    await client.query('BEGIN');

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
      [source.id,'NLTIS RAS - ' + source.associationName,source.url,source.province]
    );
    const sourceUuid=registry.rows[0].id;

    let associationId;
    const association=await client.query(
      `SELECT id FROM taxi_association WHERE registration_number=$1 LIMIT 1`,
      [source.registrationNumber]
    );

    if(association.rows[0]){
      associationId=association.rows[0].id;
      await client.query(
        `UPDATE taxi_association SET
           canonical_name=$2,
           province=$3,
           verification_status='documented',
           last_verified_at=now(),
           updated_at=now()
         WHERE id=$1`,
        [associationId,source.associationName,source.province]
      );
    }else{
      const inserted=await client.query(
        `INSERT INTO taxi_association
          (canonical_name,registration_number,province,verification_status,last_verified_at)
         VALUES ($1,$2,$3,'documented',now())
         RETURNING id`,
        [source.associationName,source.registrationNumber,source.province]
      );
      associationId=inserted.rows[0].id;
    }

    await client.query(
      `INSERT INTO source_record
        (source_id,entity_type,entity_id,external_record_id,source_payload,source_last_checked_at)
       VALUES ($1,'taxi_association',$2,$3,$4::jsonb,now())
       ON CONFLICT (source_id,entity_type,external_record_id) DO UPDATE SET
         entity_id=excluded.entity_id,
         source_payload=excluded.source_payload,
         source_last_checked_at=now(),
         source_retrieved_at=now()`,
      [sourceUuid,associationId,'association:' + source.registrationNumber,JSON.stringify({
        ...source,
        acquisitionMode,
        upstreamError,
        snapshotReportPrintedAt:acquisitionMode==='verified_snapshot' ? snapshot?.reportPrintedAt || null : null,
        snapshotCompleteness:acquisitionMode==='verified_snapshot' ? snapshot?.completeness || 'legacy_verified_snapshot' : null,
        snapshotRouteCount:acquisitionMode==='verified_snapshot' ? snapshot?.routeCount || routes.length : null,
        snapshotReportRouteRowCount:acquisitionMode==='verified_snapshot' ? snapshot?.reportRouteRowCount || routes.length : null
      })]
    );

    const quarantinedReportRows=acquisitionMode==='verified_snapshot'
      ? await recordQuarantinedRows(client,{source,sourceUuid,associationId,snapshot})
      : 0;

    let created=0;
    let updated=0;
    let rankLinks=0;

    for(const route of routes){
      const originRankId=await exactRankId(client,route.origin);
      const destinationRankId=await exactRankId(client,route.destination);
      const externalId=routeExternalId(route);
      const legacyExternalId=legacyRouteExternalId(route);
      const candidateExternalIds=[...new Set([externalId,legacyExternalId])];

      const existing=await client.query(
        `SELECT id,entity_id,external_record_id
         FROM source_record
         WHERE source_id=$1
           AND entity_type='taxi_route'
           AND external_record_id=ANY($2::text[])
         ORDER BY CASE WHEN external_record_id=$3 THEN 0 ELSE 1 END
         LIMIT 1`,
        [sourceUuid,candidateExternalIds,externalId]
      );

      let routeId;
      let sourceRecordId=null;

      if(existing.rows[0]?.entity_id){
        routeId=existing.rows[0].entity_id;
        sourceRecordId=existing.rows[0].id;

        await client.query(
          `UPDATE taxi_route SET
             association_id=$2,
             origin_rank_id=$3,
             destination_rank_id=$4,
             origin_label=$5,
             destination_label=$6,
             route_name=$7,
             national_route_code=$8,
             board_route_code=$9,
             route_type='minibus_taxi',
             street_description=$10,
             geometry=NULL,
             geometry_status='pending',
             verification_status='documented',
             last_verified_at=now(),
             updated_at=now()
           WHERE id=$1`,
          [
            routeId,
            associationId,
            originRankId,
            destinationRankId,
            route.origin,
            route.destination,
            route.routeName || null,
            route.nationalRouteCode || null,
            route.boardRouteCode || null,
            route.streetDescription || null
          ]
        );
        updated+=1;
      }else{
        const inserted=await client.query(
          `INSERT INTO taxi_route
            (association_id,origin_rank_id,destination_rank_id,origin_label,destination_label,route_name,
             national_route_code,board_route_code,route_type,street_description,geometry_status,
             verification_status,last_verified_at)
           VALUES
            ($1,$2,$3,$4,$5,$6,$7,$8,'minibus_taxi',$9,'pending','documented',now())
           RETURNING id`,
          [
            associationId,
            originRankId,
            destinationRankId,
            route.origin,
            route.destination,
            route.routeName || null,
            route.nationalRouteCode || null,
            route.boardRouteCode || null,
            route.streetDescription || null
          ]
        );
        routeId=inserted.rows[0].id;
        created+=1;
      }

      const payload=JSON.stringify({
        ...route,
        acquisitionMode,
        upstreamError,
        snapshotReportPrintedAt:acquisitionMode==='verified_snapshot' ? snapshot?.reportPrintedAt || null : null,
        snapshotCompleteness:acquisitionMode==='verified_snapshot' ? snapshot?.completeness || 'legacy_verified_snapshot' : null
      });

      if(sourceRecordId){
        await client.query(
          `UPDATE source_record SET
             entity_id=$2,
             external_record_id=$3,
             source_payload=$4::jsonb,
             source_last_checked_at=now(),
             source_retrieved_at=now()
           WHERE id=$1`,
          [sourceRecordId,routeId,externalId,payload]
        );
      }else{
        await client.query(
          `INSERT INTO source_record
            (source_id,entity_type,entity_id,external_record_id,source_payload,source_last_checked_at)
           VALUES ($1,'taxi_route',$2,$3,$4::jsonb,now())
           ON CONFLICT (source_id,entity_type,external_record_id) DO UPDATE SET
             entity_id=excluded.entity_id,
             source_payload=excluded.source_payload,
             source_last_checked_at=now(),
             source_retrieved_at=now()`,
          [sourceUuid,routeId,externalId,payload]
        );
      }

      for(const rankId of [originRankId,destinationRankId].filter(Boolean)){
        await client.query(
          `INSERT INTO taxi_rank_association
            (taxi_rank_id,association_id,verification_status,first_seen_at,last_seen_at)
           VALUES ($1,$2,'documented',now(),now())
           ON CONFLICT (taxi_rank_id,association_id) DO UPDATE SET
             verification_status='documented',
             last_seen_at=now()`,
          [rankId,associationId]
        );
        rankLinks+=1;
      }
    }

    await client.query('COMMIT');

    summary.push({
      sourceId:source.id,
      association:source.associationName,
      registrationNumber:source.registrationNumber,
      parsedRoutes:routes.length,
      acquisitionMode,
      upstreamError,
      snapshotCompleteness:acquisitionMode==='verified_snapshot' ? snapshot?.completeness || 'legacy_verified_snapshot' : null,
      created,
      updated,
      exactRankLinks:rankLinks,
      quarantinedReportRows
    });
  }

  const proof=await client.query(
    `SELECT
       (SELECT count(*)::int FROM taxi_association) associations,
       (SELECT count(*)::int FROM taxi_route WHERE verification_status='documented') documented_routes,
       (SELECT count(*)::int FROM taxi_rank_association) rank_association_links,
       (SELECT count(*)::int FROM data_issue
          WHERE issue_type='nltis_report_row_quarantined'
            AND status IN ('open','reviewing','deferred')) open_quarantined_report_rows`
  );

  console.log(JSON.stringify({
    event:'nltis_ingest_complete',
    sources:summary,
    database:proof.rows[0]
  }));
}catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  console.error(JSON.stringify({event:'nltis_ingest_failed',error:String(error?.message || error)}));
  process.exitCode=1;
}finally{
  client.release();
  await pool.end();
}
