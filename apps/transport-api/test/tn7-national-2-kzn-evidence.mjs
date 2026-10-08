import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const {Pool}=pg;
if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');

const root=resolve(new URL('.',import.meta.url).pathname);
const evidencePath=resolve(root,'../data/kzn-verified-route-association-evidence.json');
const evidence=JSON.parse(await readFile(evidencePath,'utf8'));
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:false,max:2});
const client=await pool.connect();

function normalize(value=''){
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/&/g,' and ')
    .replace(/[^a-z0-9]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

try{
  await client.query('BEGIN READ ONLY');

  const associationRows=await client.query(
    `SELECT id::text,canonical_name,acronym,coalesce(to_jsonb(taxi_association)->'aliases','[]'::jsonb) AS aliases
     FROM taxi_association
     WHERE coalesce(to_jsonb(taxi_association)->>'merged_into_association_id','')=''
     ORDER BY canonical_name`
  );

  const associationIndex=new Map();
  for(const row of associationRows.rows){
    const names=[row.canonical_name,row.acronym,...(row.aliases||[])].filter(Boolean);
    for(const name of names){
      const key=normalize(name);
      if(!key) continue;
      if(!associationIndex.has(key)) associationIndex.set(key,[]);
      associationIndex.get(key).push({id:row.id,name:row.canonical_name,matchedBy:name===row.canonical_name?'canonical_name':'alias_or_acronym'});
    }
  }

  const items=[];
  for(const item of evidence){
    const assocMatches=associationIndex.get(normalize(item.association))||[];

    const candidates=await client.query(
      `SELECT rc.id::text,rc.external_record_id,rc.route_code,rc.association_id::text,
              rc.origin_rank_id::text,rc.destination_rank_id::text,
              o.canonical_name origin_name,d.canonical_name destination_name,
              rc.reconciliation_status,rc.verification_status::text,
              s.source_key
       FROM route_candidate rc
       JOIN source_registry s ON s.id=rc.source_id
       LEFT JOIN taxi_rank o ON o.id=rc.origin_rank_id
       LEFT JOIN taxi_rank d ON d.id=rc.destination_rank_id
       WHERE lower(coalesce(rc.route_code,''))=lower($1)
       ORDER BY rc.id`,
      [item.routeCode]
    );

    const canonicalRoutes=await client.query(
      `SELECT tr.id::text,tr.association_id::text,
              (to_jsonb(tr)->>'source_route_code') AS source_route_code,
              tr.national_route_code,tr.board_route_code,
              tr.origin_rank_id::text,tr.destination_rank_id::text,
              o.canonical_name origin_name,d.canonical_name destination_name,
              a.canonical_name association_name
       FROM taxi_route tr
       LEFT JOIN taxi_rank o ON o.id=tr.origin_rank_id
       LEFT JOIN taxi_rank d ON d.id=tr.destination_rank_id
       LEFT JOIN taxi_association a ON a.id=tr.association_id
       WHERE lower(coalesce(to_jsonb(tr)->>'source_route_code',''))=lower($1)
          OR lower(coalesce(tr.national_route_code,''))=lower($1)
          OR lower(coalesce(tr.board_route_code,''))=lower($1)
       ORDER BY tr.id`,
      [item.routeCode]
    );

    const uniqueAssociation=assocMatches.length===1?assocMatches[0]:null;
    const candidateRows=candidates.rows;
    const canonicalRows=canonicalRoutes.rows;

    let bucket='unresolved';
    let reason='no_exact_route_or_association_identity_match';

    if(assocMatches.length>1){
      bucket='review_required';
      reason='association_identity_ambiguous';
    }else if(!uniqueAssociation){
      bucket='review_required';
      reason='association_not_canonical';
    }else if(canonicalRows.length>1){
      bucket='review_required';
      reason='multiple_canonical_route_code_matches';
    }else if(canonicalRows.length===1){
      const route=canonicalRows[0];
      if(route.association_id===uniqueAssociation.id){
        bucket='already_canonical';
        reason='canonical_route_already_has_documented_association';
      }else if(route.association_id && route.association_id!==uniqueAssociation.id){
        bucket='review_required';
        reason='canonical_route_association_conflict';
      }else{
        bucket='canonical_route_evidence_ready';
        reason='exact_route_code_and_unique_association_identity';
      }
    }else if(candidateRows.length>1){
      bucket='review_required';
      reason='multiple_route_candidate_code_matches';
    }else if(candidateRows.length===1){
      const candidate=candidateRows[0];
      if(candidate.association_id===uniqueAssociation.id){
        bucket='candidate_already_assigned';
        reason='route_candidate_already_has_documented_association';
      }else if(candidate.association_id && candidate.association_id!==uniqueAssociation.id){
        bucket='review_required';
        reason='route_candidate_association_conflict';
      }else{
        bucket='route_candidate_evidence_ready';
        reason='exact_route_code_and_unique_association_identity';
      }
    }

    items.push({
      routeCode:item.routeCode,
      association:item.association,
      rankNarrative:item.rankNarrative,
      source:item.source,
      sourceUrl:item.sourceUrl,
      associationMatches:assocMatches,
      routeCandidates:candidateRows,
      canonicalRoutes:canonicalRows,
      bucket,
      reason,
      canonicalMutation:false
    });
  }

  const buckets={};
  for(const item of items) buckets[item.bucket]=(buckets[item.bucket]||0)+1;

  await client.query('ROLLBACK');

  console.log(JSON.stringify({
    event:'tn7_national_2_kzn_verified_evidence_execution',
    databaseWrites:false,
    evidenceRows:evidence.length,
    buckets,
    items
  }));
}catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  console.error(JSON.stringify({
    event:'tn7_national_2_kzn_verified_evidence_execution_failed',
    error:String(error?.message||error)
  }));
  process.exitCode=1;
}finally{
  client.release();
  await pool.end();
}
