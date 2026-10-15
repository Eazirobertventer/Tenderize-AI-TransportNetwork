import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root=resolve(new URL('.',import.meta.url).pathname);
const seedPath=resolve(root,'../data/kzn-verified-route-association-evidence.json');
const indexedPath=resolve(root,'../data/kzn-national-3-indexed-gazette-evidence.json');

function normalize(value=''){
  return String(value).normalize('NFKC').toLowerCase()
    .replace(/&/g,' and ')
    .replace(/[^a-z0-9]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function classify({associationMatches,candidates,canonicalRoutes}){
  const association=associationMatches.length===1?associationMatches[0]:null;
  if(associationMatches.length>1) return {bucket:'review_required',reason:'association_identity_ambiguous'};
  if(!association) return {bucket:'association_identity_pending',reason:'association_not_canonical'};
  if(canonicalRoutes.length>1) return {bucket:'review_required',reason:'multiple_canonical_route_code_matches'};
  if(canonicalRoutes.length===1){
    const route=canonicalRoutes[0];
    if(route.association_id===association.id) return {bucket:'already_canonical',reason:'canonical_route_already_assigned'};
    if(route.association_id && route.association_id!==association.id) return {bucket:'review_required',reason:'canonical_route_association_conflict'};
    return {bucket:'canonical_route_evidence_ready',reason:'exact_route_code_and_unique_association'};
  }
  if(candidates.length>1) return {bucket:'review_required',reason:'multiple_route_candidate_code_matches'};
  if(candidates.length===1){
    const candidate=candidates[0];
    if(candidate.association_id===association.id) return {bucket:'candidate_already_assigned',reason:'route_candidate_already_assigned'};
    if(candidate.association_id && candidate.association_id!==association.id) return {bucket:'review_required',reason:'route_candidate_association_conflict'};
    return {bucket:'route_candidate_evidence_ready',reason:'exact_route_code_and_unique_association'};
  }
  return {bucket:'route_code_not_in_candidate_corpus',reason:'exact_gazette_route_code_not_found_in_route_candidate'};
}

export async function loadKznGazetteEvidenceQueue(pool,{limit=250}={}){
  if(!pool) return null;
  const bounded=Math.min(Math.max(Number(limit)||250,1),250);

  const seed=JSON.parse(await readFile(seedPath,'utf8')).map(item=>({...item,evidenceOrigin:'verified_seed'}));
  const indexed=JSON.parse(await readFile(indexedPath,'utf8'));
  const evidence=[...seed,...indexed];

  const [associationRows,candidateRows,canonicalRows]=await Promise.all([
    pool.query(`
      SELECT id::text,canonical_name,acronym,
             coalesce(to_jsonb(taxi_association)->'aliases','[]'::jsonb) AS aliases
      FROM taxi_association
      WHERE coalesce(to_jsonb(taxi_association)->>'merged_into_association_id','')=''
      ORDER BY canonical_name
    `),
    pool.query(`
      SELECT id::text,route_code,association_id::text,
             origin_rank_id::text,destination_rank_id::text,
             reconciliation_status,verification_status::text
      FROM route_candidate
      WHERE route_code IS NOT NULL
      ORDER BY id
    `),
    pool.query(`
      SELECT id::text,association_id::text,
             (to_jsonb(taxi_route)->>'source_route_code') AS source_route_code,
             national_route_code,board_route_code
      FROM taxi_route
      ORDER BY id
    `)
  ]);

  const associationIndex=new Map();
  for(const row of associationRows.rows){
    for(const label of [row.canonical_name,row.acronym,...(row.aliases||[])].filter(Boolean)){
      const key=normalize(label);
      if(!key) continue;
      if(!associationIndex.has(key)) associationIndex.set(key,[]);
      const values=associationIndex.get(key);
      if(!values.some(item=>item.id===row.id)){
        values.push({id:row.id,name:row.canonical_name,matchedBy:label===row.canonical_name?'canonical_name':'alias_or_acronym'});
      }
    }
  }

  const candidateIndex=new Map();
  for(const row of candidateRows.rows){
    const key=normalize(row.route_code);
    if(!key) continue;
    if(!candidateIndex.has(key)) candidateIndex.set(key,[]);
    candidateIndex.get(key).push(row);
  }

  const canonicalIndex=new Map();
  for(const row of canonicalRows.rows){
    for(const code of [row.source_route_code,row.national_route_code,row.board_route_code].filter(Boolean)){
      const key=normalize(code);
      if(!key) continue;
      if(!canonicalIndex.has(key)) canonicalIndex.set(key,[]);
      const values=canonicalIndex.get(key);
      if(!values.some(item=>item.id===row.id)) values.push(row);
    }
  }

  const items=evidence.map(item=>{
    const associationMatches=associationIndex.get(normalize(item.association))||[];
    const candidates=candidateIndex.get(normalize(item.routeCode))||[];
    const canonicalRoutes=canonicalIndex.get(normalize(item.routeCode))||[];
    const status=classify({associationMatches,candidates,canonicalRoutes});
    return {
      ...item,
      associationMatches,
      routeCandidates:candidates,
      canonicalRoutes,
      ...status,
      canonicalMutation:false,
      adjudicationRequired:['route_candidate_evidence_ready','canonical_route_evidence_ready'].includes(status.bucket)
    };
  });

  const buckets={};
  const origins={};
  for(const item of items){
    buckets[item.bucket]=(buckets[item.bucket]||0)+1;
    origins[item.evidenceOrigin]=(origins[item.evidenceOrigin]||0)+1;
  }

  const order={
    route_candidate_evidence_ready:1,
    canonical_route_evidence_ready:2,
    review_required:3,
    association_identity_pending:4,
    route_code_not_in_candidate_corpus:5,
    candidate_already_assigned:6,
    already_canonical:7
  };
  items.sort((a,b)=>
    (order[a.bucket]||99)-(order[b.bucket]||99) ||
    String(a.routeCode).localeCompare(String(b.routeCode))
  );

  return {
    mode:'kzn_gazette_evidence_queue',
    province:'KwaZulu-Natal',
    canonicalMutationEnabled:false,
    automaticPromotionEnabled:false,
    policy:{
      exactRouteCodeRequired:true,
      uniqueCanonicalAssociationRequiredForReady:true,
      indexedEvidenceMustStillBeOperatorReviewed:true,
      promotionRoute:'existing_ADJ5_ADJ6_workflows'
    },
    sourceAvailability:{
      directPdfBatch:{
        attempted:13,
        succeeded:0,
        blockedByRemoteHosts:true,
        failureClass:'remote_http_access_blocked'
      },
      indexedGazetteRecovery:true
    },
    evidence:{
      total:items.length,
      origins,
      buckets,
      readyForControlledReview:items.filter(item=>item.adjudicationRequired).length
    },
    queue:{
      total:items.length,
      returned:Math.min(items.length,bounded),
      limit:bounded,
      items:items.slice(0,bounded)
    }
  };
}
