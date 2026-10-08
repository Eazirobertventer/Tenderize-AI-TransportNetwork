import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import pg from 'pg';
import { parseGazetteText } from './parser.mjs';

const require=createRequire(import.meta.url);
const pdf=require('pdf-parse');
const {Pool}=pg;

if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');

const sources=JSON.parse(await readFile(new URL('./tn7-national-3-sources.json',import.meta.url),'utf8'));
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:false,max:2});
const client=await pool.connect();

function norm(value=''){
  return String(value).normalize('NFKC').toLowerCase()
    .replace(/&/g,' and ')
    .replace(/[^a-z0-9]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

async function fetchBuffer(url){
  const response=await fetch(url,{
    headers:{'user-agent':'TenderizeTransportNetwork/1.0 tn7-national3-readonly'},
    signal:AbortSignal.timeout(90000)
  });
  if(!response.ok) throw new Error('HTTP '+response.status+' '+response.statusText+' '+url);
  return Buffer.from(await response.arrayBuffer());
}

function addIndex(map,key,value){
  if(!key) return;
  if(!map.has(key)) map.set(key,[]);
  const values=map.get(key);
  if(!values.some(item=>item.id===value.id)) values.push(value);
}

function bestRankMatches(mention,rankIndex){
  const n=norm(mention);
  if(!n) return [];
  const exact=rankIndex.get(n)||[];
  if(exact.length) return exact;

  const candidates=[];
  for(const [key,values] of rankIndex){
    if(key.length<5 || n.length<5) continue;
    if(n.includes(key) || key.includes(n)){
      for(const value of values){
        if(!candidates.some(x=>x.id===value.id)) candidates.push(value);
      }
    }
  }
  return candidates;
}

try{
  await client.query('BEGIN READ ONLY');

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
      WHERE province='KwaZulu-Natal'
        AND coalesce(to_jsonb(taxi_rank)->>'merged_into_rank_id','')=''
      ORDER BY canonical_name
    `),
    client.query(`
      SELECT id::text,route_code,association_id::text,
             origin_rank_id::text,destination_rank_id::text
      FROM route_candidate
      ORDER BY id
    `)
  ]);

  const associationIndex=new Map();
  for(const row of assocRows.rows){
    for(const name of [row.canonical_name,row.acronym,...(row.aliases||[])].filter(Boolean)){
      addIndex(associationIndex,norm(name),{id:row.id,name:row.canonical_name});
    }
  }

  const rankIndex=new Map();
  for(const row of rankRows.rows){
    for(const name of [row.canonical_name,...(row.aliases||[])].filter(Boolean)){
      addIndex(rankIndex,norm(name),{
        id:row.id,name:row.canonical_name,province:row.province,
        municipality:row.municipality,town:row.town
      });
    }
  }

  const candidateIndex=new Map();
  for(const row of candidateRows.rows){
    const key=norm(row.route_code);
    if(!key) continue;
    if(!candidateIndex.has(key)) candidateIndex.set(key,[]);
    candidateIndex.get(key).push(row);
  }

  const documents=[];
  const rows=[];
  const failures=[];

  for(const source of sources){
    try{
      const buffer=await fetchBuffer(source.url);
      const parsedPdf=await pdf(buffer);
      const parsed=parseGazetteText(parsedPdf.text,source);
      documents.push({
        documentId:source.documentId,
        date:source.date,
        url:source.url,
        bytes:buffer.length,
        evidenceRows:parsed.rows.length
      });
      rows.push(...parsed.rows);
    }catch(error){
      failures.push({
        documentId:source.documentId,
        url:source.url,
        error:String(error?.message||error)
      });
    }
  }

  const queue=[];
  const bucketCounts={};
  const associationLabels=new Set();
  const routeIdentifiers=new Set();
  const rankMentions=new Set();

  for(const row of rows){
    if(row.normalizedAssociationLabel) associationLabels.add(row.normalizedAssociationLabel);
    for(const id of row.routeIdentifiers||[]) routeIdentifiers.add(id);
    for(const mention of row.normalizedRankMentions||[]) rankMentions.add(mention);

    const associationMatches=row.normalizedAssociationLabel
      ? (associationIndex.get(row.normalizedAssociationLabel)||[])
      : [];

    const routeMatches=[];
    for(const routeId of row.routeIdentifiers||[]){
      for(const match of candidateIndex.get(norm(routeId))||[]){
        if(!routeMatches.some(item=>item.id===match.id)) routeMatches.push(match);
      }
    }

    const resolvedMentions=[];
    for(const mention of row.rankMentions||[]){
      const matches=bestRankMatches(mention,rankIndex);
      resolvedMentions.push({mention,matches});
    }

    const uniqueRankMatches=[];
    for(const item of resolvedMentions){
      if(item.matches.length===1 && !uniqueRankMatches.some(x=>x.id===item.matches[0].id)){
        uniqueRankMatches.push(item.matches[0]);
      }
    }

    let bucket='unresolved';
    let reason='insufficient_deterministic_identity';

    if(associationMatches.length>1){
      bucket='review_required';
      reason='association_identity_ambiguous';
    }else if(associationMatches.length===0 && row.associationLabel){
      bucket='association_identity_pending';
      reason='association_not_canonical';
    }else if(associationMatches.length===1 && routeMatches.length===1){
      const route=routeMatches[0];
      if(route.association_id===associationMatches[0].id){
        bucket='already_assigned';
        reason='route_candidate_already_has_association';
      }else if(route.association_id && route.association_id!==associationMatches[0].id){
        bucket='review_required';
        reason='route_candidate_association_conflict';
      }else{
        bucket='route_candidate_evidence_ready';
        reason='exact_route_identifier_and_unique_association';
      }
    }else if(associationMatches.length===1 && routeMatches.length>1){
      bucket='review_required';
      reason='multiple_route_candidate_matches';
    }else if(associationMatches.length===1 && uniqueRankMatches.length>0){
      bucket='rank_association_evidence_ready';
      reason='unique_association_and_unique_rank_mention';
    }else if(associationMatches.length===1 && resolvedMentions.some(item=>item.matches.length>1)){
      bucket='review_required';
      reason='rank_mention_ambiguous';
    }else if(associationMatches.length===1){
      bucket='association_only_evidence';
      reason='association_resolved_but_no_unique_rank_or_route_match';
    }

    bucketCounts[bucket]=(bucketCounts[bucket]||0)+1;

    if(bucket!=='unresolved'){
      queue.push({
        bucket,
        reason,
        documentId:row.documentId,
        documentDate:row.documentDate,
        sourceUrl:row.sourceUrl,
        applicationNumber:row.applicationNumber,
        associationLabel:row.associationLabel,
        associationMatches,
        routeIdentifiers:row.routeIdentifiers||[],
        routeCandidateMatches:routeMatches,
        rankMentions:row.rankMentions||[],
        resolvedRankMentions:resolvedMentions,
        uniqueRankMatches,
        extractionConfidence:row.extractionConfidence,
        canonicalMutation:false
      });
    }
  }

  const order={
    route_candidate_evidence_ready:1,
    rank_association_evidence_ready:2,
    review_required:3,
    association_identity_pending:4,
    association_only_evidence:5,
    already_assigned:6,
    unresolved:7
  };
  queue.sort((a,b)=>
    (order[a.bucket]||99)-(order[b.bucket]||99) ||
    Number(b.extractionConfidence||0)-Number(a.extractionConfidence||0) ||
    String(a.documentId||'').localeCompare(String(b.documentId||'')) ||
    String(a.applicationNumber||'').localeCompare(String(b.applicationNumber||''))
  );

  const boundedQueue=queue.slice(0,250);

  await client.query('ROLLBACK');

  console.log(JSON.stringify({
    event:'tn7_national_3_kzn_corpus_summary',
    databaseWrites:false,
    canonicalMutation:false,
    documentsAttempted:sources.length,
    documentsSucceeded:documents.length,
    documentsFailed:failures.length,
    documents,
    failures,
    evidenceRows:rows.length,
    uniqueAssociationLabels:associationLabels.size,
    uniqueRouteIdentifiers:routeIdentifiers.size,
    uniqueNormalizedRankMentions:rankMentions.size,
    buckets:bucketCounts,
    totalClassified:queue.length,
    returned:boundedQueue.length,
    boundedLimit:250
  }));

  const resultPayload={
    databaseWrites:false,
    canonicalMutation:false,
    documentsAttempted:sources.length,
    documentsSucceeded:documents.length,
    documentsFailed:failures.length,
    documents,
    failures,
    corpus:{
      evidenceRows:rows.length,
      uniqueAssociationLabels:associationLabels.size,
      uniqueRouteIdentifiers:routeIdentifiers.size,
      uniqueNormalizedRankMentions:rankMentions.size
    },
    buckets:bucketCounts,
    evidenceQueue:{
      totalClassified:queue.length,
      returned:boundedQueue.length,
      boundedLimit:250,
      items:boundedQueue
    }
  };

  console.log(JSON.stringify({
    event:'tn7_national_3_kzn_corpus_summary',
    ...resultPayload,
    evidenceQueue:{...resultPayload.evidenceQueue,items:undefined}
  }));

  if(process.env.SERVE_RESULT==='true'){
    const port=Number(process.env.PORT||3000);
    createServer((req,res)=>{
      const url=new URL(req.url||'/','http://localhost');
      res.setHeader('content-type','application/json; charset=utf-8');
      res.setHeader('cache-control','no-store');
      if(url.pathname==='/health'){
        res.end(JSON.stringify({ok:true,event:'tn7_national_3_corpus_result',documentsSucceeded:documents.length}));
        return;
      }
      if(url.pathname==='/summary'){
        res.end(JSON.stringify({...resultPayload,evidenceQueue:{...resultPayload.evidenceQueue,items:undefined}}));
        return;
      }
      if(url.pathname==='/queue'){
        const limit=Math.min(Math.max(Number(url.searchParams.get('limit')||50),1),250);
        const offset=Math.max(Number(url.searchParams.get('offset')||0),0);
        res.end(JSON.stringify({
          total:boundedQueue.length,
          offset,
          limit,
          items:boundedQueue.slice(offset,offset+limit)
        }));
        return;
      }
      res.statusCode=404;
      res.end(JSON.stringify({error:'not_found'}));
    }).listen(port,'0.0.0.0',()=>console.log(JSON.stringify({
      event:'tn7_national_3_result_server_ready',
      port,
      documentsSucceeded:documents.length,
      queueItems:boundedQueue.length
    })));
  }else{
    for(let i=0;i<boundedQueue.length;i++){
      console.log(JSON.stringify({
        event:'tn7_national_3_evidence_queue_item',
        queueIndex:i+1,
        ...boundedQueue[i]
      }));
    }
  }
}catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  console.error(JSON.stringify({
    event:'tn7_national_3_kzn_corpus_expansion_failed',
    error:String(error?.message||error)
  }));
  process.exitCode=1;
}finally{
  client.release();
  await pool.end();
}
