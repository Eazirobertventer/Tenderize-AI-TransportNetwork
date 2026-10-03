import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const { Pool } = pg;
const port = Number(process.env.PORT || 8080);
const root = resolve(new URL('../../..', import.meta.url).pathname);
const seed = JSON.parse(await readFile(resolve(root, 'prototype/data/seed-network.json'), 'utf8'));
const pool = process.env.DATABASE_URL ? new Pool({connectionString:process.env.DATABASE_URL,max:5,ssl:false}) : null;

function send(res,status,payload){
  res.writeHead(status,{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store',
    'access-control-allow-origin':process.env.CORS_ORIGIN || '*'
  });
  res.end(JSON.stringify(payload));
}

function seedRanks(url){
  const province=url.searchParams.get('province')?.toLowerCase();
  const q=url.searchParams.get('q')?.toLowerCase();
  const rows=seed.ranks.filter(rank =>
    (!province || rank.province?.toLowerCase()===province) &&
    (!q || [rank.name,rank.town,rank.province].some(v => (v || '').toLowerCase().includes(q)))
  );
  return {
    type:'FeatureCollection',
    features:rows.map(rank => ({
      type:'Feature',
      id:rank.id,
      geometry:{type:'Point',coordinates:[rank.lng,rank.lat]},
      properties:{
        id:rank.id,
        name:rank.name,
        town:rank.town || null,
        municipality:null,
        province:rank.province || null,
        verificationStatus:rank.status || 'unverified',
        source:rank.source || null
      }
    }))
  };
}

async function postgisRanks(url){
  const params=[];
  const where=['r.location IS NOT NULL'];
  const province=url.searchParams.get('province');
  const q=url.searchParams.get('q');

  if (province) {
    params.push(province);
    where.push(`r.province = $${params.length}`);
  }

  if (q) {
    params.push('%' + q + '%');
    const i=params.length;
    where.push(`(r.canonical_name ILIKE $${i} OR coalesce(r.town,'') ILIKE $${i} OR coalesce(r.municipality,'') ILIKE $${i})`);
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
       sr.source_payload,
       s.source_name
     FROM taxi_rank r
     LEFT JOIN LATERAL (
       SELECT source_id, source_payload
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
        source:row.source_name || 'PostGIS canonical',
        sourcePayload:row.source_payload || null
      }
    }))
  };
}

async function meta(){
  if (!pool) {
    return {
      mode:'seed',
      ranks:seed.ranks.length,
      associations:seed.associations.length,
      routes:seed.routes.length,
      sources:seed.sources.length,
      productionComplete:false
    };
  }

  const result=await pool.query(
    `SELECT
       (SELECT count(*)::int FROM taxi_rank) AS ranks,
       (SELECT count(*)::int FROM taxi_association) AS associations,
       (SELECT count(*)::int FROM taxi_route) AS routes,
       (SELECT count(*)::int FROM source_registry) AS sources`
  );

  return {mode:'postgis',...result.rows[0],productionComplete:false};
}

async function rankDetail(id){
  if (!pool) {
    const rank=seed.ranks.find(r => r.id===id);
    if (!rank) return null;
    return {
      ...rank,
      routes:seed.routes.filter(r => r.originRankId===id || r.destinationRankId===id)
    };
  }

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
       sr.source_payload,
       sr.source_last_checked_at
     FROM source_record sr
     JOIN source_registry s ON s.id=sr.source_id
     WHERE sr.entity_type='taxi_rank' AND sr.entity_id=$1::uuid
     ORDER BY sr.source_retrieved_at DESC`,
    [id]
  );

  return {...rank.rows[0],sources:sources.rows};
}

const server=createServer(async (req,res) => {
  const url=new URL(req.url,`http://${req.headers.host || 'localhost'}`);

  try {
    if (url.pathname==='/health') {
      if (pool) await pool.query('select 1');
      return send(res,200,{ok:true,service:'transport-api',mode:pool?'postgis':'seed'});
    }

    if (url.pathname==='/api/v1/meta') {
      return send(res,200,await meta());
    }

    if (url.pathname==='/api/v1/ranks') {
      return send(res,200,pool ? await postgisRanks(url) : seedRanks(url));
    }

    if (url.pathname.startsWith('/api/v1/ranks/')) {
      const id=decodeURIComponent(url.pathname.split('/').pop());
      const rank=await rankDetail(id);
      return rank ? send(res,200,rank) : send(res,404,{error:'rank_not_found'});
    }

    return send(res,404,{error:'not_found'});
  } catch (error) {
    console.error(error);
    return send(res,500,{error:'internal_error'});
  }
});

server.listen(port,'0.0.0.0',() => {
  console.log(`transport-api listening on :${port} (${pool?'postgis':'seed'} mode)`);
});

process.on('SIGTERM',async() => {
  if (pool) await pool.end();
  server.close();
});
