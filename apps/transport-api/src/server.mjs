import { createServer } from 'node:http';
import pg from 'pg';

const { Pool } = pg;
const port = Number(process.env.PORT || 8080);
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString:process.env.DATABASE_URL,
  max:5,
  ssl:false
}) : null;

function send(res,status,payload){
  res.writeHead(status,{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store',
    'access-control-allow-origin':process.env.CORS_ORIGIN || '*'
  });
  res.end(JSON.stringify(payload));
}

async function postgisRanks(url){
  const params=[];
  const where=['r.location IS NOT NULL'];
  const province=url.searchParams.get('province');
  const city=url.searchParams.get('city');
  const q=url.searchParams.get('q');

  if (province) {
    params.push(province);
    where.push(`r.province = $${params.length}`);
  }

  if (city) {
    params.push(city);
    const i=params.length;
    where.push(`coalesce(nullif(trim(r.town),''),nullif(trim(r.municipality),'')) = ${i}`);
  }

  if (q) {
    params.push('%' + q + '%');
    const i=params.length;
    where.push(`(r.canonical_name ILIKE ${i} OR coalesce(r.town,'') ILIKE ${i} OR coalesce(r.municipality,'') ILIKE ${i})`);
  }

  const result=await pool.query(
    `SELECT
       r.id::text,
       r.canonical_name,
       r.town,
       r.municipality,
       r.province,
       r.verification_status::text,
       ST_X(r.location) AS lng,
       ST_Y(r.location) AS lat,
       s.source_name
     FROM taxi_rank r
     LEFT JOIN LATERAL (
       SELECT source_id
       FROM source_record
       WHERE entity_type='taxi_rank' AND entity_id=r.id
       ORDER BY source_retrieved_at DESC
       LIMIT 1
     ) sr ON true
     LEFT JOIN source_registry s ON s.id=sr.source_id
     WHERE ${where.join(' AND ')}
     ORDER BY r.canonical_name
     LIMIT 10000`,
    params
  );

  return {
    type:'FeatureCollection',
    features:result.rows.map(row => ({
      type:'Feature',
      id:row.id,
      geometry:{type:'Point',coordinates:[Number(row.lng),Number(row.lat)]},
      properties:{
        id:row.id,
        name:row.canonical_name,
        town:row.town,
        municipality:row.municipality,
        province:row.province,
        verificationStatus:row.verification_status,
        source:row.source_name || 'PostGIS canonical'
      }
    }))
  };
}

async function postgisRankFilters(url){
  const province=url.searchParams.get('province');

  const provinces=await pool.query(
    `SELECT DISTINCT province
     FROM taxi_rank
     WHERE location IS NOT NULL
       AND province IS NOT NULL
       AND trim(province)<>''
     ORDER BY province`
  );

  const params=[];
  const where=[
    'location IS NOT NULL',
    "coalesce(nullif(trim(town),''),nullif(trim(municipality),'')) IS NOT NULL"
  ];

  if(province){
    params.push(province);
    where.push(`province = ${params.length}`);
  }

  const cities=await pool.query(
    `SELECT DISTINCT coalesce(nullif(trim(town),''),nullif(trim(municipality),'')) AS city
     FROM taxi_rank
     WHERE ${where.join(' AND ')}
     ORDER BY city`,
    params
  );

  return {
    provinces:provinces.rows.map(row=>row.province),
    cities:cities.rows.map(row=>row.city)
  };
}

async function postgisRoutes(url){
  const params=[];
  const where=['tr.geometry IS NOT NULL'];
  const bbox=url.searchParams.get('bbox');
  const sourceKey=url.searchParams.get('source');

  if (bbox) {
    const parts=bbox.split(',').map(Number);
    if(parts.length===4 && parts.every(Number.isFinite)){
      params.push(parts[0],parts[1],parts[2],parts[3]);
      const n=params.length;
      where.push(`ST_Intersects(tr.geometry,ST_MakeEnvelope($${n-3},$${n-2},$${n-1},$${n},4326))`);
    }
  }

  if(sourceKey){
    params.push(sourceKey);
    where.push(`s.source_key = $${params.length}`);
  }

  const result=await pool.query(
    `SELECT
       tr.id::text,
       tr.origin_label,
       tr.destination_label,
       tr.route_name,
       tr.route_type,
       tr.national_route_code,
       tr.board_route_code,
       tr.geometry_status,
       tr.verification_status::text,
       ST_AsGeoJSON(tr.geometry)::json AS geometry,
       a.canonical_name AS association_name,
       a.registration_number AS association_registration,
       s.source_key,
       s.source_name
     FROM taxi_route tr
     LEFT JOIN LATERAL (
       SELECT source_id
       FROM source_record
       WHERE entity_type='taxi_route' AND entity_id=tr.id
       ORDER BY source_retrieved_at DESC
       LIMIT 1
     ) sr ON true
     LEFT JOIN source_registry s ON s.id=sr.source_id
     LEFT JOIN taxi_association a ON a.id=tr.association_id
     WHERE ${where.join(' AND ')}
     ORDER BY tr.id
     LIMIT 5000`,
    params
  );

  return {
    type:'FeatureCollection',
    features:result.rows.map(row => ({
      type:'Feature',
      id:row.id,
      geometry:row.geometry,
      properties:{
        id:row.id,
        origin:row.origin_label,
        destination:row.destination_label,
        name:row.route_name,
        routeType:row.route_type,
        nationalRouteCode:row.national_route_code,
        boardRouteCode:row.board_route_code,
        geometryStatus:row.geometry_status,
        verificationStatus:row.verification_status,
        association:row.association_name,
        associationRegistration:row.association_registration,
        sourceKey:row.source_key,
        source:row.source_name || 'PostGIS canonical'
      }
    }))
  };
}

async function postgisNltisEndpointEvidence(url){
  const params=[];
  const where=[
    "s.source_class='nltis_olas'",
    "tr.verification_status='documented'",
    "tr.origin_rank_id IS NOT NULL",
    "tr.destination_rank_id IS NOT NULL",
    "origin.location IS NOT NULL",
    "destination.location IS NOT NULL"
  ];
  const bbox=url.searchParams.get('bbox');
  const sourceKey=url.searchParams.get('source');

  if(bbox){
    const parts=bbox.split(',').map(Number);
    if(parts.length===4 && parts.every(Number.isFinite)){
      params.push(parts[0],parts[1],parts[2],parts[3]);
      const n=params.length;
      where.push(`ST_Intersects(ST_MakeLine(origin.location,destination.location),ST_MakeEnvelope(${n-3},${n-2},${n-1},${n},4326))`);
    }
  }

  if(sourceKey){
    params.push(sourceKey);
    where.push(`s.source_key = ${params.length}`);
  }

  const result=await pool.query(
    `SELECT
       tr.id::text,
       tr.origin_label,
       tr.destination_label,
       tr.route_name,
       tr.route_type,
       tr.national_route_code,
       tr.board_route_code,
       tr.verification_status::text,
       ST_AsGeoJSON(ST_MakeLine(origin.location,destination.location))::json AS geometry,
       a.canonical_name AS association_name,
       a.registration_number AS association_registration,
       s.source_key,
       s.source_name
     FROM taxi_route tr
     JOIN taxi_rank origin ON origin.id=tr.origin_rank_id
     JOIN taxi_rank destination ON destination.id=tr.destination_rank_id
     JOIN taxi_association a ON a.id=tr.association_id
     JOIN LATERAL (
       SELECT registry.source_key,registry.source_name,registry.source_class
       FROM source_record sr
       JOIN source_registry registry ON registry.id=sr.source_id
       WHERE sr.entity_type='taxi_route' AND sr.entity_id=tr.id
       ORDER BY sr.source_retrieved_at DESC
       LIMIT 1
     ) s ON true
     WHERE ${where.join(' AND ')}
     ORDER BY tr.id
     LIMIT 5000`,
    params
  );

  return {
    type:'FeatureCollection',
    evidenceType:'nltis_exact_endpoint_connector',
    notRoutePath:true,
    features:result.rows.map(row=>({
      type:'Feature',
      id:row.id,
      geometry:row.geometry,
      properties:{
        id:row.id,
        origin:row.origin_label,
        destination:row.destination_label,
        name:row.route_name,
        routeType:row.route_type,
        nationalRouteCode:row.national_route_code,
        boardRouteCode:row.board_route_code,
        geometryStatus:'endpoint_connector_evidence',
        verificationStatus:row.verification_status,
        association:row.association_name,
        associationRegistration:row.association_registration,
        sourceKey:row.source_key,
        source:row.source_name || 'NLTIS / OLAS',
        evidenceOnly:true,
        exactEndpoints:true,
        notRoutePath:true
      }
    }))
  };
}

async function postgisAssociations(url){
  const params=[];
  const where=['1=1'];
  const province=url.searchParams.get('province');
  const q=url.searchParams.get('q');

  if(province){
    params.push(province);
    where.push(`a.province = $${params.length}`);
  }

  if(q){
    params.push('%' + q + '%');
    const i=params.length;
    where.push(`(a.canonical_name ILIKE $${i} OR coalesce(a.registration_number,'') ILIKE $${i} OR coalesce(a.acronym,'') ILIKE $${i})`);
  }

  const result=await pool.query(
    `SELECT
       a.id::text,
       a.canonical_name,
       a.acronym,
       a.registration_number,
       a.affiliation,
       a.province,
       a.municipality,
       a.address,
       a.verification_status::text,
       count(DISTINCT ra.taxi_rank_id)::int AS rank_count,
       count(DISTINCT tr.id)::int AS route_count
     FROM taxi_association a
     LEFT JOIN taxi_rank_association ra ON ra.association_id=a.id
     LEFT JOIN taxi_route tr ON tr.association_id=a.id
     WHERE ${where.join(' AND ')}
     GROUP BY a.id
     ORDER BY a.canonical_name
     LIMIT 5000`,
    params
  );

  return {items:result.rows};
}

async function postgisDataIssues(url){
  const params=[];
  const where=["status IN ('open','reviewing','deferred')"];
  const issueType=url.searchParams.get('issueType');
  const sourceKey=url.searchParams.get('source');
  const limit=Math.min(Math.max(Number(url.searchParams.get('limit') || 200),1),1000);

  if(issueType){
    params.push(issueType);
    where.push(`issue_type = $${params.length}`);
  }

  if(sourceKey){
    params.push(sourceKey);
    where.push(`detail->>'sourceKey' = $${params.length}`);
  }

  params.push(limit);

  const result=await pool.query(
    `SELECT
       id::text,
       entity_type,
       entity_id::text,
       issue_type,
       severity,
       summary,
       detail,
       status,
       created_at,
       resolved_at
     FROM data_issue
     WHERE ${where.join(' AND ')}
     ORDER BY
       CASE severity WHEN 'blocking' THEN 1 WHEN 'error' THEN 2 WHEN 'warning' THEN 3 ELSE 4 END,
       created_at DESC
     LIMIT $${params.length}`,
    params
  );

  return {items:result.rows};
}

async function postgisRankReconciliation(url){
  const sourceA=url.searchParams.get('sourceA') || 'ethekwini-bus-taxi-ranks-degraded';
  const sourceB=url.searchParams.get('sourceB') || 'kzn-taxi-ranks-degraded-tls';
  const requested=Number(url.searchParams.get('maxDistance') || 100);
  const maxDistance=Math.min(Math.max(Number.isFinite(requested)?requested:100,1),500);

  const result=await pool.query(
    `WITH source_a AS (
       SELECT DISTINCT
         r.id,
         r.canonical_name,
         r.location,
         sr.external_record_id
       FROM taxi_rank r
       JOIN source_record sr
         ON sr.entity_type='taxi_rank' AND sr.entity_id=r.id
       JOIN source_registry s ON s.id=sr.source_id
       WHERE s.source_key=$1
         AND r.location IS NOT NULL
     ),
     source_b AS (
       SELECT DISTINCT
         r.id,
         r.canonical_name,
         r.location,
         sr.external_record_id
       FROM taxi_rank r
       JOIN source_record sr
         ON sr.entity_type='taxi_rank' AND sr.entity_id=r.id
       JOIN source_registry s ON s.id=sr.source_id
       WHERE s.source_key=$2
         AND r.location IS NOT NULL
     ),
     nearest AS (
       SELECT
         a.id AS source_a_rank_id,
         a.canonical_name AS source_a_name,
         a.external_record_id AS source_a_external_id,
         ST_X(a.location) AS source_a_lng,
         ST_Y(a.location) AS source_a_lat,
         b.id AS source_b_rank_id,
         b.canonical_name AS source_b_name,
         b.external_record_id AS source_b_external_id,
         ST_X(b.location) AS source_b_lng,
         ST_Y(b.location) AS source_b_lat,
         ST_DistanceSphere(a.location,b.location) AS distance_m
       FROM source_a a
       CROSS JOIN LATERAL (
         SELECT b.*
         FROM source_b b
         ORDER BY a.location <-> b.location
         LIMIT 1
       ) b
     ),
     within_100 AS (
       SELECT
         a.id AS source_a_rank_id,
         count(*)::int AS candidates_within_100m
       FROM source_a a
       JOIN source_b b
         ON ST_DWithin(a.location::geography,b.location::geography,100)
       GROUP BY a.id
     )
     SELECT
       n.*,
       coalesce(w.candidates_within_100m,0) AS candidates_within_100m
     FROM nearest n
     LEFT JOIN within_100 w ON w.source_a_rank_id=n.source_a_rank_id
     ORDER BY n.distance_m, n.source_a_name`,
    [sourceA,sourceB]
  );

  const rows=result.rows.map(row=>({
    sourceA:{
      id:row.source_a_rank_id,
      name:row.source_a_name,
      externalId:row.source_a_external_id,
      coordinates:[Number(row.source_a_lng),Number(row.source_a_lat)]
    },
    sourceB:{
      id:row.source_b_rank_id,
      name:row.source_b_name,
      externalId:row.source_b_external_id,
      coordinates:[Number(row.source_b_lng),Number(row.source_b_lat)]
    },
    distanceM:Number(Number(row.distance_m).toFixed(2)),
    candidatesWithin100m:Number(row.candidates_within_100m)
  }));

  const buckets={
    lt25:0,
    m25to50:0,
    m50to100:0,
    m100to200:0,
    gte200:0
  };
  for(const row of rows){
    const d=row.distanceM;
    if(d<25) buckets.lt25+=1;
    else if(d<50) buckets.m25to50+=1;
    else if(d<100) buckets.m50to100+=1;
    else if(d<200) buckets.m100to200+=1;
    else buckets.gte200+=1;
  }

  return {
    sourceA,
    sourceB,
    sourceACount:rows.length,
    maxDistanceM:maxDistance,
    nearestDistanceBuckets:buckets,
    ambiguousWithin100m:rows.filter(row=>row.candidatesWithin100m>1).length,
    candidates:rows.filter(row=>row.distanceM<=maxDistance)
  };
}

async function meta(){
  if (!pool) {
    return {mode:'unconfigured',ranks:0,associations:0,routes:0,sources:0,productionComplete:false};
  }

  const result=await pool.query(
    `SELECT
       (SELECT count(*)::int FROM taxi_rank) AS ranks,
       (SELECT count(*)::int FROM taxi_rank WHERE location IS NOT NULL) AS mapped_ranks,
       (SELECT count(*)::int FROM taxi_rank WHERE location IS NULL) AS location_pending_ranks,
       (SELECT count(*)::int FROM taxi_association) AS associations,
       (SELECT count(*)::int FROM taxi_route) AS routes,
       (SELECT count(*)::int FROM source_registry) AS sources,
       (SELECT count(*)::int FROM data_issue WHERE status IN ('open','reviewing','deferred')) AS open_issues`
  );
  return {mode:'postgis',...result.rows[0],productionComplete:false};
}

async function rankDetail(id){
  if (!pool) return null;

  const rank=await pool.query(
    `SELECT
       r.id::text,
       r.canonical_name AS name,
       r.address,
       r.town,
       r.municipality,
       r.province,
       r.verification_status::text AS "verificationStatus",
       ST_X(r.location) AS lng,
       ST_Y(r.location) AS lat
     FROM taxi_rank r
     WHERE r.id=$1::uuid`,
    [id]
  );

  if (!rank.rows[0]) return null;

  const sources=await pool.query(
    `SELECT
       s.source_key,
       s.source_name,
       s.authority,
       sr.external_record_id,
       sr.source_last_checked_at
     FROM source_record sr
     JOIN source_registry s ON s.id=sr.source_id
     WHERE sr.entity_type='taxi_rank' AND sr.entity_id=$1::uuid
     ORDER BY sr.source_retrieved_at DESC`,
    [id]
  );

  const associations=await pool.query(
    `SELECT
       a.id::text,
       a.canonical_name AS name,
       a.acronym,
       a.registration_number,
       a.verification_status::text AS "verificationStatus"
     FROM taxi_rank_association ra
     JOIN taxi_association a ON a.id=ra.association_id
     WHERE ra.taxi_rank_id=$1::uuid
     ORDER BY a.canonical_name`,
    [id]
  );

  const routes=await pool.query(
    `SELECT
       tr.id::text,
       tr.origin_label AS origin,
       tr.destination_label AS destination,
       tr.route_name AS name,
       tr.national_route_code AS "nationalRouteCode",
       tr.board_route_code AS "boardRouteCode",
       tr.geometry_status AS "geometryStatus",
       tr.verification_status::text AS "verificationStatus",
       a.canonical_name AS association
     FROM taxi_route tr
     LEFT JOIN taxi_association a ON a.id=tr.association_id
     WHERE tr.origin_rank_id=$1::uuid OR tr.destination_rank_id=$1::uuid
     ORDER BY tr.route_name
     LIMIT 500`,
    [id]
  );

  return {
    ...rank.rows[0],
    sources:sources.rows,
    associations:associations.rows,
    routes:routes.rows
  };
}

const server=createServer(async(req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host || 'localhost'}`);

  try{
    if(url.pathname==='/health'){
      if(!pool) return send(res,503,{ok:false,service:'transport-api',mode:'unconfigured'});
      await pool.query('select 1');
      return send(res,200,{ok:true,service:'transport-api',mode:'postgis'});
    }

    if(url.pathname==='/api/v1/meta'){
      if(!pool) return send(res,503,{error:'database_not_configured'});
      return send(res,200,await meta());
    }

    if(url.pathname==='/api/v1/ranks'){
      if(!pool) return send(res,503,{error:'database_not_configured'});
      return send(res,200,await postgisRanks(url));
    }

    if(url.pathname==='/api/v1/rank-filters'){
      if(!pool) return send(res,503,{error:'database_not_configured'});
      return send(res,200,await postgisRankFilters(url));
    }

    if(url.pathname==='/api/v1/routes'){
      if(!pool) return send(res,503,{error:'database_not_configured'});
      return send(res,200,await postgisRoutes(url));
    }

    if(url.pathname==='/api/v1/nltis/endpoint-evidence'){
      if(!pool) return send(res,503,{error:'database_not_configured'});
      return send(res,200,await postgisNltisEndpointEvidence(url));
    }

    if(url.pathname==='/api/v1/associations'){
      if(!pool) return send(res,503,{error:'database_not_configured'});
      return send(res,200,await postgisAssociations(url));
    }

    if(url.pathname==='/api/v1/data-issues'){
      if(!pool) return send(res,503,{error:'database_not_configured'});
      return send(res,200,await postgisDataIssues(url));
    }

    if(url.pathname==='/api/v1/reconciliation/rank-candidates'){
      if(!pool) return send(res,503,{error:'database_not_configured'});
      return send(res,200,await postgisRankReconciliation(url));
    }

    if(url.pathname.startsWith('/api/v1/ranks/')){
      if(!pool) return send(res,503,{error:'database_not_configured'});
      const id=decodeURIComponent(url.pathname.split('/').pop());
      const rank=await rankDetail(id);
      return rank ? send(res,200,rank) : send(res,404,{error:'rank_not_found'});
    }

    return send(res,404,{error:'not_found'});
  }catch(error){
    console.error(error);
    return send(res,500,{error:'internal_error'});
  }
});

server.listen(port,'0.0.0.0',()=>console.log(`transport-api listening on :${port} (${pool?'postgis':'unconfigured'} mode)`));

process.on('SIGTERM',async()=>{
  if(pool) await pool.end();
  server.close();
});
