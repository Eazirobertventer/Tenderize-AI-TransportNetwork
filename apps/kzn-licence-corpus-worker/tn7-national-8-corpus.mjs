import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import pg from 'pg';
import { parseGazetteText } from './parser.mjs';
import {
  discoverAdapterDocuments,
  dedupeDocuments,
  fetchWithPolicy,
  normalizeEvidenceRows,
  normalizeEvidenceText,
  classifyEvidenceRow
} from './evidence-execution-framework.mjs';
import {
  evidenceCacheEnabled,
  loadCachedEvidenceArtifact,
  storeEvidenceArtifact
} from './artifact-cache.mjs';

const require=createRequire(import.meta.url);
const pdf=require('pdf-parse');
const {Pool}=pg;

if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');

const manifest=JSON.parse(await readFile(new URL('./tn7-national-8-sources.json',import.meta.url),'utf8'));
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:false,max:3});
const client=await pool.connect();

function addIndex(map,key,value){
  if(!key) return;
  if(!map.has(key)) map.set(key,[]);
  if(!map.get(key).some(item=>item.id===value.id)) map.get(key).push(value);
}

function bestRankMatches(mention,rankIndex){
  const key=normalizeEvidenceText(mention);
  if(!key) return [];
  const exact=rankIndex.get(key)||[];
  if(exact.length) return exact;
  return [];
}

async function mapLimit(items,limit,fn){
  const results=new Array(items.length);
  let next=0;
  async function worker(){
    while(true){
      const i=next++;
      if(i>=items.length) return;
      results[i]=await fn(items[i],i);
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));
  return results;
}

try{
  await client.query('BEGIN READ ONLY');

  const discoveries=await mapLimit(manifest.adapters,4,discoverAdapterDocuments);
  const documents=dedupeDocuments(discoveries,{maxDocuments:manifest.maximumDocumentsPerRun||500});

  const [assocRows,rankRows,candidateRows]=await Promise.all([
    client.query(`
      SELECT id::text,canonical_name,acronym,
             coalesce(to_jsonb(taxi_association)->'aliases','[]'::jsonb) AS aliases
      FROM taxi_association
      WHERE coalesce(to_jsonb(taxi_association)->>'merged_into_association_id','')=''
      ORDER BY canonical_name
    `),
    client.query(`
      SELECT id::text,canonical_name,
             coalesce(to_jsonb(taxi_rank)->'aliases','[]'::jsonb) AS aliases,
             province,municipality,town
      FROM taxi_rank
      WHERE province=$1
        AND coalesce(to_jsonb(taxi_rank)->>'merged_into_rank_id','')=''
      ORDER BY canonical_name
    `,[manifest.province]),
    client.query(`
      SELECT id::text,route_code,association_id::text,
             origin_rank_id::text,destination_rank_id::text
      FROM route_candidate
      WHERE route_code IS NOT NULL
      ORDER BY id
    `)
  ]);

  const associationIndex=new Map();
  for(const row of assocRows.rows){
    for(const value of [row.canonical_name,row.acronym,...(row.aliases||[])].filter(Boolean)){
      addIndex(associationIndex,normalizeEvidenceText(value),{id:row.id,name:row.canonical_name});
    }
  }

  const rankIndex=new Map();
  for(const row of rankRows.rows){
    for(const value of [row.canonical_name,...(row.aliases||[])].filter(Boolean)){
      addIndex(rankIndex,normalizeEvidenceText(value),{
        id:row.id,name:row.canonical_name,province:row.province,
        municipality:row.municipality,town:row.town
      });
    }
  }

  const candidateIndex=new Map();
  for(const row of candidateRows.rows){
    addIndex(candidateIndex,normalizeEvidenceText(row.route_code),row);
  }

  const cacheOnly=process.env.EVIDENCE_CACHE_ONLY==='true';

  const parsedDocuments=await mapLimit(documents,4,async document=>{
    let acquisition=null;
    let cacheState={enabled:evidenceCacheEnabled(),hit:false};

    if(evidenceCacheEnabled()){
      try{
        const cached=await loadCachedEvidenceArtifact(document.url);
        if(cached.hit){
          acquisition={
            ok:true,
            buffer:cached.buffer,
            bytes:cached.bytes,
            checksum:cached.checksum,
            contentType:cached.contentType,
            finalUrl:cached.manifest?.finalUrl||document.url,
            source:'cache'
          };
          cacheState={
            enabled:true,
            hit:true,
            artifactKey:cached.manifest?.artifactKey||null,
            pointerKey:cached.pointerKey
          };
        }
      }catch(error){
        cacheState={
          enabled:true,
          hit:false,
          readError:String(error?.message||error)
        };
      }
    }

    if(!acquisition && cacheOnly){
      return {
        ...document,
        ok:false,
        error:'cache_miss_remote_disabled',
        acquisitionSource:'cache_only',
        cache:cacheState
      };
    }

    if(!acquisition){
      const fetched=await fetchWithPolicy(document.url,{
        retries:2,
        timeoutMs:90000,
        maxBytes:50*1024*1024
      });
      if(!fetched.ok){
        return {
          ...document,
          ok:false,
          error:fetched.error,
          acquisitionSource:'remote',
          cache:cacheState
        };
      }
      acquisition={...fetched,source:'remote'};

      if(evidenceCacheEnabled()){
        try{
          const stored=await storeEvidenceArtifact({
            buffer:fetched.buffer,
            sourceUrl:document.url,
            finalUrl:fetched.finalUrl,
            checksum:fetched.checksum,
            contentType:fetched.contentType||'application/pdf',
            bytes:fetched.bytes,
            authority:document.authority,
            retrievalMirror:document.retrievalMirror||null,
            sourceAdapter:document.adapterId,
            documentId:document.documentId
          });
          cacheState={
            enabled:true,
            hit:false,
            stored:stored.stored,
            reused:stored.reused,
            artifactKey:stored.artifactKey,
            manifestKey:stored.manifestKey,
            pointerKey:stored.pointerKey
          };
        }catch(error){
          return {
            ...document,
            ok:false,
            error:'cache_persist_failed:'+String(error?.message||error),
            checksum:fetched.checksum,
            bytes:fetched.bytes,
            acquisitionSource:'remote',
            cache:cacheState
          };
        }
      }
    }

    try{
      const parsedPdf=await pdf(acquisition.buffer);
      const parsed=parseGazetteText(parsedPdf.text,{
        documentId:document.documentId,
        date:document.date||null,
        url:document.url,
        authority:document.authority
      });
      return {
        ...document,
        ok:true,
        bytes:acquisition.bytes,
        checksum:acquisition.checksum,
        contentType:acquisition.contentType||null,
        finalUrl:acquisition.finalUrl,
        acquisitionSource:acquisition.source,
        cache:cacheState,
        evidenceRows:normalizeEvidenceRows(parsed.rows,{document,checksum:acquisition.checksum})
      };
    }catch(error){
      return {
        ...document,
        ok:false,
        error:'parse_failed:'+String(error?.message||error),
        checksum:acquisition.checksum||null,
        bytes:acquisition.bytes||null,
        acquisitionSource:acquisition.source,
        cache:cacheState
      };
    }
  });

  const evidenceById=new Map();
  for(const document of parsedDocuments){
    for(const row of document.evidenceRows||[]){
      if(!evidenceById.has(row.evidenceId)) evidenceById.set(row.evidenceId,row);
    }
  }
  const evidence=[...evidenceById.values()];

  const queue=[];
  const buckets={};
  for(const row of evidence){
    const associationMatches=associationIndex.get(row.normalizedAssociationLabel)||[];
    const routeMatches=[];
    for(const routeId of row.routeIdentifiers){
      for(const match of candidateIndex.get(normalizeEvidenceText(routeId))||[]){
        if(!routeMatches.some(x=>x.id===match.id)) routeMatches.push(match);
      }
    }

    const rankMatches=[];
    for(const mention of row.rankMentions){
      for(const match of bestRankMatches(mention,rankIndex)){
        if(!rankMatches.some(x=>x.id===match.id)) rankMatches.push(match);
      }
    }

    const classification=classifyEvidenceRow(row,{
      associationMatches,
      routeCandidateMatches:routeMatches,
      rankMatches
    });
    buckets[classification.bucket]=(buckets[classification.bucket]||0)+1;

    queue.push({
      ...row,
      ...classification,
      associationMatches,
      routeCandidateMatches:routeMatches,
      rankMatches,
      canonicalMutation:false,
      automaticPromotion:false
    });
  }

  const order={
    route_candidate_evidence_ready:1,
    rank_association_evidence_ready:2,
    association_identity_pending:3,
    conflict:4,
    review_required:5,
    association_only_evidence:6,
    already_assigned:7,
    unresolved:8
  };
  queue.sort((a,b)=>
    (order[a.bucket]||99)-(order[b.bucket]||99) ||
    Number(b.extractionConfidence||0)-Number(a.extractionConfidence||0) ||
    String(a.evidenceId).localeCompare(String(b.evidenceId))
  );

  const boundedQueue=queue.slice(0,manifest.maximumQueueItems||1000);
  await client.query('ROLLBACK');

  const result={
    mode:'tn7_national_8_kzn_high_volume_corpus',
    province:manifest.province,
    databaseWrites:false,
    canonicalMutation:false,
    automaticPromotion:false,
    cache:{
      enabled:evidenceCacheEnabled(),
      cacheOnly,
      hits:parsedDocuments.filter(x=>x.cache?.hit===true).length,
      remoteAcquisitions:parsedDocuments.filter(x=>x.acquisitionSource==='remote' && x.ok).length,
      stored:parsedDocuments.filter(x=>x.cache?.stored===true).length,
      reused:parsedDocuments.filter(x=>x.cache?.reused===true).length
    },
    discovery:{
      adapters:manifest.adapters.length,
      adaptersSucceeded:discoveries.filter(x=>x.ok).length,
      adaptersFailed:discoveries.filter(x=>!x.ok).length,
      discoveredDocuments:documents.length
    },
    documents:{
      attempted:parsedDocuments.length,
      succeeded:parsedDocuments.filter(x=>x.ok).length,
      failed:parsedDocuments.filter(x=>!x.ok).length,
      failureSummary:parsedDocuments
        .filter(x=>!x.ok)
        .reduce((acc,x)=>{
          const key=String(x.error||'unknown_failure').split(':')[0];
          acc[key]=(acc[key]||0)+1;
          return acc;
        },{}),
      failures:parsedDocuments
        .filter(x=>!x.ok)
        .slice(0,25)
        .map(x=>({
          documentId:x.documentId,
          url:x.url,
          adapterId:x.adapterId,
          error:x.error||'unknown_failure'
        })),
      items:parsedDocuments.map(x=>({
        documentId:x.documentId,
        url:x.url,
        adapterId:x.adapterId,
        ok:x.ok,
        bytes:x.bytes||null,
        checksum:x.checksum||null,
        evidenceRows:(x.evidenceRows||[]).length,
        error:x.error||null,
        acquisitionSource:x.acquisitionSource||null,
        cache:x.cache||null
      }))
    },
    corpus:{
      normalizedEvidenceRows:evidence.length,
      uniqueEvidenceIds:evidenceById.size
    },
    buckets,
    queue:{
      total:queue.length,
      returned:boundedQueue.length,
      limit:manifest.maximumQueueItems||1000,
      items:boundedQueue
    }
  };

  console.log(JSON.stringify({
    event:'tn7_national_8_kzn_corpus_summary',
    ...result,
    documents:{...result.documents,items:undefined},
    queue:{...result.queue,items:undefined}
  }));

  if(process.env.SERVE_RESULT==='true'){
    const port=Number(process.env.PORT||3000);
    createServer((req,res)=>{
      const url=new URL(req.url||'/','http://localhost');
      res.setHeader('content-type','application/json; charset=utf-8');
      res.setHeader('cache-control','no-store');
      if(url.pathname==='/health') return res.end(JSON.stringify({ok:true,mode:result.mode}));
      if(url.pathname==='/summary') return res.end(JSON.stringify({...result,documents:{...result.documents,items:undefined},queue:{...result.queue,items:undefined}}));
      if(url.pathname==='/queue'){
        const limit=Math.min(Math.max(Number(url.searchParams.get('limit')||100),1),250);
        const offset=Math.max(Number(url.searchParams.get('offset')||0),0);
        return res.end(JSON.stringify({total:result.queue.total,offset,limit,items:boundedQueue.slice(offset,offset+limit)}));
      }
      if(url.pathname==='/documents'){
        const limit=Math.min(Math.max(Number(url.searchParams.get('limit')||100),1),250);
        const offset=Math.max(Number(url.searchParams.get('offset')||0),0);
        return res.end(JSON.stringify({total:result.documents.items.length,offset,limit,items:result.documents.items.slice(offset,offset+limit)}));
      }
      res.statusCode=404;
      res.end(JSON.stringify({error:'not_found'}));
    }).listen(port,'0.0.0.0',()=>console.log(JSON.stringify({event:'tn7_national_8_result_server_ready',port})));
  }
}catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  console.error(JSON.stringify({event:'tn7_national_8_failed',error:String(error?.message||error)}));
  process.exitCode=1;
}finally{
  client.release();
  await pool.end();
}
