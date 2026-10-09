function normalizeRouteIdentity(value=''){
  return String(value)
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g,'')
    .trim();
}

function uniqueById(rows=[]){
  const seen=new Set();
  return rows.filter(row=>{
    const id=row.id || [row.source_key,row.external_record_id,row.route_code].join(':');
    if(seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export async function recoverRouteEvidenceGaps(pool,{
  province,
  evidenceRows,
  limit=50
}={}){
  if(!pool) return null;
  const bounded=Math.min(Math.max(Number(limit)||50,1),250);
  const rows=(evidenceRows||[]).slice(0,bounded);
  const output=[];

  for(const evidence of rows){
    const code=String(evidence.routeCode||'').trim();
    const normalized=normalizeRouteIdentity(code);
    if(!normalized){
      output.push({...evidence,recoveryBucket:'invalid_route_code',recoverable:false});
      continue;
    }

    const [geometry,candidates,sourceRecords]=await Promise.all([
      pool.query(
        `SELECT
           srg.id::text,
           srg.route_code,
           srg.province,
           srg.municipality,
           srg.district,
           srg.category,
           srg.map_title,
           srg.verification_status::text,
           srg.source_date,
           srg.source_payload,
           srg.promoted_route_id::text,
           s.source_key,
           s.source_name,
           s.authority,
           s.official
         FROM source_route_geometry srg
         JOIN source_registry s ON s.id=srg.source_id
         WHERE ($1::text IS NULL OR srg.province=$1)
           AND (
             upper(regexp_replace(coalesce(srg.route_code,''),'[^A-Za-z0-9]+','','g'))=$2
             OR upper(regexp_replace(coalesce(srg.source_payload::text,''),'[^A-Za-z0-9]+','','g')) LIKE '%'||$2||'%'
           )
         ORDER BY
           CASE WHEN upper(regexp_replace(coalesce(srg.route_code,''),'[^A-Za-z0-9]+','','g'))=$2 THEN 0 ELSE 1 END,
           s.official DESC,
           srg.id
         LIMIT 25`,
        [province||null,normalized]
      ),
      pool.query(
        `SELECT
           rc.id::text,
           rc.route_code,
           rc.external_record_id,
           rc.source_route_geometry_id::text,
           rc.origin_rank_id::text,
           rc.destination_rank_id::text,
           rc.association_id::text,
           rc.reconciliation_status,
           rc.verification_status::text,
           rc.provenance,
           s.source_key,
           s.source_name,
           o.province AS origin_province,
           d.province AS destination_province
         FROM route_candidate rc
         JOIN source_registry s ON s.id=rc.source_id
         LEFT JOIN taxi_rank o ON o.id=rc.origin_rank_id
         LEFT JOIN taxi_rank d ON d.id=rc.destination_rank_id
         WHERE ($1::text IS NULL OR coalesce(o.province,d.province)=$1)
           AND (
             upper(regexp_replace(coalesce(rc.route_code,''),'[^A-Za-z0-9]+','','g'))=$2
             OR upper(regexp_replace(coalesce(rc.external_record_id,''),'[^A-Za-z0-9]+','','g'))=$2
             OR upper(regexp_replace(coalesce(rc.provenance::text,''),'[^A-Za-z0-9]+','','g')) LIKE '%'||$2||'%'
           )
         ORDER BY
           CASE WHEN upper(regexp_replace(coalesce(rc.route_code,''),'[^A-Za-z0-9]+','','g'))=$2 THEN 0
                WHEN upper(regexp_replace(coalesce(rc.external_record_id,''),'[^A-Za-z0-9]+','','g'))=$2 THEN 1
                ELSE 2 END,
           rc.id
         LIMIT 25`,
        [province||null,normalized]
      ),
      pool.query(
        `SELECT
           sr.id::text,
           sr.entity_type,
           sr.entity_id::text,
           sr.external_record_id,
           sr.source_payload,
           s.source_key,
           s.source_name,
           s.authority
         FROM source_record sr
         JOIN source_registry s ON s.id=sr.source_id
         WHERE sr.entity_type='taxi_route'
           AND (
             upper(regexp_replace(coalesce(sr.external_record_id,''),'[^A-Za-z0-9]+','','g'))=$1
             OR upper(regexp_replace(coalesce(sr.source_payload::text,''),'[^A-Za-z0-9]+','','g')) LIKE '%'||$1||'%'
           )
         ORDER BY sr.id
         LIMIT 25`,
        [normalized]
      )
    ]);

    const exactGeometry=geometry.rows.filter(row=>normalizeRouteIdentity(row.route_code)===normalized);
    const exactCandidateCode=candidates.rows.filter(row=>normalizeRouteIdentity(row.route_code)===normalized);
    const exactCandidateExternal=candidates.rows.filter(row=>
      normalizeRouteIdentity(row.external_record_id)===normalized &&
      normalizeRouteIdentity(row.route_code)!==normalized
    );
    const candidatePayloadOnly=candidates.rows.filter(row=>
      normalizeRouteIdentity(row.route_code)!==normalized &&
      normalizeRouteIdentity(row.external_record_id)!==normalized
    );
    const exactSourceRecord=sourceRecords.rows.filter(row=>
      normalizeRouteIdentity(row.external_record_id)===normalized
    );
    const payloadSourceRecord=sourceRecords.rows.filter(row=>
      normalizeRouteIdentity(row.external_record_id)!==normalized
    );

    let recoveryBucket='no_defensible_match';
    let reason='no_source_geometry_candidate_or_source_record_match';
    let recoverable=false;
    let recommendedAction='investigate_external_source';

    if(exactCandidateCode.length){
      recoveryBucket='candidate_exists_after_normalization';
      reason='normalized_route_code_matches_existing_candidate';
      recoverable=false;
      recommendedAction='reclassify_evidence_queue_against_normalized_identity';
    }else if(exactGeometry.length===1){
      recoveryBucket='candidate_generation_gap';
      reason='one_exact_source_geometry_exists_without_route_candidate';
      recoverable=true;
      recommendedAction='re-run_existing_candidate_generation_for_source_geometry';
    }else if(exactGeometry.length>1){
      recoveryBucket='multiple_source_geometry_matches';
      reason='multiple_exact_source_geometries_require_source_review';
      recommendedAction='review_source_geometry_duplicates';
    }else if(exactCandidateExternal.length===1){
      recoveryBucket='alternate_candidate_identifier';
      reason='candidate_external_record_id_matches_gazette_route_code';
      recommendedAction='review_route_code_alias_or_source_mapping';
    }else if(exactCandidateExternal.length>1){
      recoveryBucket='ambiguous_alternate_identifier';
      reason='multiple_candidates_share_matching_external_identifier';
      recommendedAction='manual_identity_review';
    }else if(exactSourceRecord.length===1){
      recoveryBucket='canonical_source_record_match';
      reason='existing_canonical_route_source_record_uses_gazette_identifier';
      recommendedAction='reconcile_canonical_route_code_identity';
    }else if(exactSourceRecord.length>1){
      recoveryBucket='ambiguous_canonical_source_record';
      reason='multiple_canonical_source_records_share_identifier';
      recommendedAction='manual_identity_review';
    }else if(candidatePayloadOnly.length || payloadSourceRecord.length || geometry.rows.length){
      recoveryBucket='payload_reference_only';
      reason='route_code_appears_only_inside_source_payload_or_provenance';
      recommendedAction='operator_evidence_review';
    }

    output.push({
      ...evidence,
      normalizedRouteCode:normalized,
      recoveryBucket,
      reason,
      recoverable,
      recommendedAction,
      automaticCandidateCreation:false,
      automaticCanonicalMutation:false,
      matches:{
        exactSourceGeometry:uniqueById(exactGeometry),
        exactCandidateCode:uniqueById(exactCandidateCode),
        alternateCandidateIdentifier:uniqueById(exactCandidateExternal),
        candidatePayloadOnly:uniqueById(candidatePayloadOnly),
        exactCanonicalSourceRecord:uniqueById(exactSourceRecord),
        sourceRecordPayloadOnly:uniqueById(payloadSourceRecord)
      }
    });
  }

  const buckets={};
  for(const item of output) buckets[item.recoveryBucket]=(buckets[item.recoveryBucket]||0)+1;

  return {
    mode:'national_route_evidence_gap_recovery',
    province:province||null,
    canonicalMutationEnabled:false,
    automaticCandidateCreationEnabled:false,
    normalizationPolicy:{
      unicode:'NFKC',
      case:'uppercase',
      punctuation:'removed',
      numericPaddingPreserved:true,
      fuzzyMatching:false
    },
    evidenceRows:output.length,
    buckets,
    items:output
  };
}

export { normalizeRouteIdentity };
