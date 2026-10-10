import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root=resolve(new URL('.',import.meta.url).pathname);
const verifiedEvidencePath=resolve(root,'../data/kzn-verified-route-association-evidence.json');

function normalize(value=''){
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/&/g,' and ')
    .replace(/[^a-z0-9]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function classifyVerifiedEvidence({associationMatches,candidates,canonicalRoutes}){
  const uniqueAssociation=associationMatches.length===1?associationMatches[0]:null;

  if(associationMatches.length>1){
    return {bucket:'review_required',reason:'association_identity_ambiguous'};
  }
  if(!uniqueAssociation){
    return {bucket:'review_required',reason:'association_not_canonical'};
  }
  if(canonicalRoutes.length>1){
    return {bucket:'review_required',reason:'multiple_canonical_route_code_matches'};
  }
  if(canonicalRoutes.length===1){
    const route=canonicalRoutes[0];
    if(route.association_id===uniqueAssociation.id){
      return {bucket:'already_canonical',reason:'canonical_route_already_has_documented_association'};
    }
    if(route.association_id && route.association_id!==uniqueAssociation.id){
      return {bucket:'review_required',reason:'canonical_route_association_conflict'};
    }
    return {bucket:'canonical_route_evidence_ready',reason:'exact_route_code_and_unique_association_identity'};
  }
  if(candidates.length>1){
    return {bucket:'review_required',reason:'multiple_route_candidate_code_matches'};
  }
  if(candidates.length===1){
    const candidate=candidates[0];
    if(candidate.association_id===uniqueAssociation.id){
      return {bucket:'candidate_already_assigned',reason:'route_candidate_already_has_documented_association'};
    }
    if(candidate.association_id && candidate.association_id!==uniqueAssociation.id){
      return {bucket:'review_required',reason:'route_candidate_association_conflict'};
    }
    return {bucket:'route_candidate_evidence_ready',reason:'exact_route_code_and_unique_association_identity'};
  }
  return {bucket:'unresolved',reason:'no_exact_route_or_association_identity_match'};
}

export async function loadKznCoverageExecution(pool){
  if(!pool) return null;

  const verifiedEvidence=JSON.parse(await readFile(verifiedEvidencePath,'utf8'));

  const [summaryResult,sourceRows,routeBuckets,municipalities,associationRows]=await Promise.all([
    pool.query(`
      WITH kzn_ranks AS (
        SELECT r.id,r.canonical_name,r.location,r.municipality,r.town
        FROM taxi_rank r
        WHERE r.province='KwaZulu-Natal'
          AND coalesce(to_jsonb(r)->>'merged_into_rank_id','')=''
      ),
      kzn_routes AS (
        SELECT tr.*
        FROM taxi_route tr
        LEFT JOIN taxi_association a ON a.id=tr.association_id
        LEFT JOIN taxi_rank o ON o.id=tr.origin_rank_id
        LEFT JOIN taxi_rank d ON d.id=tr.destination_rank_id
        WHERE coalesce(a.province,o.province,d.province)='KwaZulu-Natal'
      ),
      kzn_candidates AS (
        SELECT rc.*
        FROM route_candidate rc
        LEFT JOIN taxi_rank o ON o.id=rc.origin_rank_id
        LEFT JOIN taxi_rank d ON d.id=rc.destination_rank_id
        WHERE coalesce(o.province,d.province)='KwaZulu-Natal'
      )
      SELECT
        (SELECT count(*)::int FROM kzn_ranks) AS ranks,
        (SELECT count(*)::int FROM kzn_ranks WHERE location IS NOT NULL) AS mapped_ranks,
        (SELECT count(*)::int FROM kzn_ranks WHERE location IS NULL) AS location_pending,
        (SELECT count(*)::int FROM kzn_ranks r WHERE NOT EXISTS (
          SELECT 1 FROM taxi_rank_association ra WHERE ra.taxi_rank_id=r.id
        )) AS ranks_without_association,
        (SELECT count(*)::int FROM taxi_association a
         WHERE a.province='KwaZulu-Natal'
           AND coalesce(to_jsonb(a)->>'merged_into_association_id','')='') AS associations,
        (SELECT count(*)::int FROM kzn_routes) AS routes,
        (SELECT count(*)::int FROM kzn_routes WHERE association_id IS NULL) AS routes_without_association,
        (SELECT count(*)::int FROM kzn_routes WHERE origin_rank_id IS NULL OR destination_rank_id IS NULL) AS routes_with_unresolved_endpoints,
        (SELECT count(*)::int FROM kzn_candidates) AS route_candidates,
        (SELECT count(*)::int FROM kzn_candidates WHERE association_id IS NULL) AS route_candidates_without_association,
        (SELECT count(*)::int FROM rank_association_candidate rac JOIN kzn_ranks r ON r.id=rac.taxi_rank_id) AS rank_association_candidates
    `),
    pool.query(`
      SELECT s.source_key,s.source_name,s.source_class,s.official,
             count(sr.*)::int AS records,
             count(sr.*) FILTER (WHERE sr.entity_type='taxi_rank')::int AS rank_records,
             count(sr.*) FILTER (WHERE sr.entity_type='taxi_route')::int AS route_records,
             count(sr.*) FILTER (WHERE sr.entity_type='taxi_association')::int AS association_records
      FROM source_registry s
      JOIN source_record sr ON sr.source_id=s.id
      LEFT JOIN taxi_rank r ON sr.entity_type='taxi_rank' AND sr.entity_id=r.id
      LEFT JOIN taxi_association a ON sr.entity_type='taxi_association' AND sr.entity_id=a.id
      LEFT JOIN taxi_route tr ON sr.entity_type='taxi_route' AND sr.entity_id=tr.id
      LEFT JOIN taxi_rank o ON tr.origin_rank_id=o.id
      LEFT JOIN taxi_rank d ON tr.destination_rank_id=d.id
      WHERE coalesce(r.province,a.province,o.province,d.province)='KwaZulu-Natal'
         OR s.source_key LIKE 'kzn-%'
      GROUP BY s.id,s.source_key,s.source_name,s.source_class,s.official
      ORDER BY records DESC,s.source_key
    `),
    pool.query(`
      WITH kzn_candidates AS (
        SELECT rc.*
        FROM route_candidate rc
        LEFT JOIN taxi_rank o ON o.id=rc.origin_rank_id
        LEFT JOIN taxi_rank d ON d.id=rc.destination_rank_id
        WHERE coalesce(o.province,d.province)='KwaZulu-Natal'
      ),
      endpoint_evidence AS (
        SELECT rc.id,
          coalesce(array_agg(DISTINCT oa.id) FILTER (WHERE oa.id IS NOT NULL),'{}'::uuid[]) origin_assoc_ids,
          coalesce(array_agg(DISTINCT da.id) FILTER (WHERE da.id IS NOT NULL),'{}'::uuid[]) destination_assoc_ids
        FROM kzn_candidates rc
        LEFT JOIN taxi_rank_association ora ON ora.taxi_rank_id=rc.origin_rank_id
        LEFT JOIN taxi_association oa ON oa.id=ora.association_id
        LEFT JOIN taxi_rank_association dra ON dra.taxi_rank_id=rc.destination_rank_id
        LEFT JOIN taxi_association da ON da.id=dra.association_id
        GROUP BY rc.id
      )
      SELECT bucket,count(*)::int
      FROM (
        SELECT rc.id,
          CASE
            WHEN rc.association_id IS NOT NULL THEN 'assigned'
            WHEN cardinality(e.origin_assoc_ids)=1
             AND cardinality(e.destination_assoc_ids)=1
             AND e.origin_assoc_ids[1]=e.destination_assoc_ids[1] THEN 'unique_shared_association'
            WHEN cardinality(e.origin_assoc_ids)>0 AND cardinality(e.destination_assoc_ids)>0 THEN 'conflicting_or_multiple'
            WHEN cardinality(e.origin_assoc_ids)>0 THEN 'origin_only'
            WHEN cardinality(e.destination_assoc_ids)>0 THEN 'destination_only'
            ELSE 'no_association_evidence'
          END AS bucket
        FROM kzn_candidates rc
        JOIN endpoint_evidence e ON e.id=rc.id
      ) x
      GROUP BY bucket
      ORDER BY bucket
    `),
    pool.query(`
      SELECT
        coalesce(nullif(trim(r.town),''),nullif(trim(r.municipality),''),'Unknown') municipality,
        count(*)::int ranks,
        count(*) FILTER (WHERE r.location IS NULL)::int location_pending,
        count(*) FILTER (WHERE NOT EXISTS (
          SELECT 1 FROM taxi_rank_association ra WHERE ra.taxi_rank_id=r.id
        ))::int without_association,
        count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM rank_association_candidate rac WHERE rac.taxi_rank_id=r.id
        ))::int with_association_candidate
      FROM taxi_rank r
      WHERE r.province='KwaZulu-Natal'
        AND coalesce(to_jsonb(r)->>'merged_into_rank_id','')=''
      GROUP BY 1
      ORDER BY without_association DESC,location_pending DESC,ranks DESC,municipality
      LIMIT 100
    `),
    pool.query(`
      SELECT id::text,canonical_name,acronym,coalesce(to_jsonb(taxi_association)->'aliases','[]'::jsonb) AS aliases
      FROM taxi_association
      WHERE coalesce(to_jsonb(taxi_association)->>'merged_into_association_id','')=''
      ORDER BY canonical_name
    `)
  ]);

  const associationIndex=new Map();
  for(const row of associationRows.rows){
    const names=[row.canonical_name,row.acronym,...(row.aliases||[])].filter(Boolean);
    for(const name of names){
      const key=normalize(name);
      if(!key) continue;
      if(!associationIndex.has(key)) associationIndex.set(key,[]);
      associationIndex.get(key).push({
        id:row.id,
        name:row.canonical_name,
        matchedBy:name===row.canonical_name?'canonical_name':'alias_or_acronym'
      });
    }
  }

  const routeCodes=verifiedEvidence.map(item=>item.routeCode);
  const [candidateMatches,canonicalMatches]=await Promise.all([
    pool.query(`
      SELECT rc.id::text,rc.external_record_id,rc.route_code,rc.association_id::text,
             rc.origin_rank_id::text,rc.destination_rank_id::text,
             o.canonical_name origin_name,d.canonical_name destination_name,
             rc.reconciliation_status,rc.verification_status::text,s.source_key
      FROM route_candidate rc
      JOIN source_registry s ON s.id=rc.source_id
      LEFT JOIN taxi_rank o ON o.id=rc.origin_rank_id
      LEFT JOIN taxi_rank d ON d.id=rc.destination_rank_id
      WHERE lower(coalesce(rc.route_code,''))=ANY($1::text[])
      ORDER BY rc.route_code,rc.id
    `,[routeCodes.map(x=>x.toLowerCase())]),
    pool.query(`
      SELECT tr.id::text,tr.association_id::text,
             (to_jsonb(tr)->>'source_route_code') AS source_route_code,
             tr.national_route_code,tr.board_route_code,
             tr.origin_rank_id::text,tr.destination_rank_id::text,
             o.canonical_name origin_name,d.canonical_name destination_name,
             a.canonical_name association_name
      FROM taxi_route tr
      LEFT JOIN taxi_rank o ON o.id=tr.origin_rank_id
      LEFT JOIN taxi_rank d ON d.id=tr.destination_rank_id
      LEFT JOIN taxi_association a ON a.id=tr.association_id
      WHERE lower(coalesce(to_jsonb(tr)->>'source_route_code',''))=ANY($1::text[])
         OR lower(coalesce(tr.national_route_code,''))=ANY($1::text[])
         OR lower(coalesce(tr.board_route_code,''))=ANY($1::text[])
      ORDER BY tr.id
    `,[routeCodes.map(x=>x.toLowerCase())])
  ]);

  const candidateByCode=new Map();
  for(const row of candidateMatches.rows){
    const key=String(row.route_code||'').toLowerCase();
    if(!candidateByCode.has(key)) candidateByCode.set(key,[]);
    candidateByCode.get(key).push(row);
  }

  const canonicalByCode=new Map();
  for(const row of canonicalMatches.rows){
    for(const code of [row.source_route_code,row.national_route_code,row.board_route_code].filter(Boolean)){
      const key=String(code).toLowerCase();
      if(!canonicalByCode.has(key)) canonicalByCode.set(key,[]);
      canonicalByCode.get(key).push(row);
    }
  }

  const verifiedItems=verifiedEvidence.map(item=>{
    const associationMatches=associationIndex.get(normalize(item.association))||[];
    const candidates=candidateByCode.get(item.routeCode.toLowerCase())||[];
    const canonicalRoutes=canonicalByCode.get(item.routeCode.toLowerCase())||[];
    const classification=classifyVerifiedEvidence({associationMatches,candidates,canonicalRoutes});

    return {
      ...item,
      associationMatches,
      routeCandidates:candidates,
      canonicalRoutes,
      ...classification,
      canonicalMutation:false
    };
  });

  const verifiedBuckets={};
  for(const item of verifiedItems){
    verifiedBuckets[item.bucket]=(verifiedBuckets[item.bucket]||0)+1;
  }

  return {
    mode:'kzn_source_execution',
    province:'KwaZulu-Natal',
    canonicalMutationEnabled:false,
    policy:{
      spatialProximityAloneIsProof:false,
      exactRouteCodeRequiredForVerifiedGazetteJoin:true,
      uniqueAssociationIdentityRequiredForReadyBucket:true,
      promotionRequiresExistingAdjudicationWorkflow:true
    },
    summary:summaryResult.rows[0],
    routeCandidateBuckets:Object.fromEntries(routeBuckets.rows.map(row=>[row.bucket,row.count])),
    sourceInventory:sourceRows.rows,
    municipalities:municipalities.rows,
    verifiedGazette:{
      rows:verifiedItems.length,
      buckets:verifiedBuckets,
      items:verifiedItems
    }
  };
}
