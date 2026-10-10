function basicNormalize(value=''){
  return String(value).normalize('NFKC').toLowerCase()
    .replace(/&/g,' and ')
    .replace(/[^a-z0-9]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function deterministicVariantNormalize(value=''){
  return basicNormalize(value)
    .split(' ')
    .map(token=>({
      ass:'association',
      assoc:'association',
      assn:'association',
      toa:'taxi owners association'
    }[token] || token))
    .join(' ')
    .replace(/\s+/g,' ')
    .trim();
}

function uniqueById(rows=[]){
  const seen=new Set();
  return rows.filter(row=>{
    if(seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

async function loadRankAssociationCandidateEvidence(db,requested,exactKey){
  const capability=await db.query(
    "SELECT to_regprocedure('normalize_transport_identity_name(text)') IS NOT NULL AS available"
  );
  if(capability.rows?.[0]?.available){
    return db.query(
      `SELECT rac.id::text,rac.taxi_rank_id::text,rac.association_label,
              rac.verification_status::text,rac.first_seen_at,rac.last_seen_at,
              r.canonical_name AS rank_name,r.province,r.district,r.municipality,r.town,
              s.source_key,s.source_name,s.authority
         FROM rank_association_candidate rac
         JOIN taxi_rank r ON r.id=rac.taxi_rank_id
         JOIN source_registry s ON s.id=rac.source_id
         WHERE normalize_transport_identity_name(rac.association_label)=normalize_transport_identity_name($1)
         ORDER BY rac.last_seen_at DESC,rac.id`,
      [requested]
    );
  }

  const fallback=await db.query(
    `SELECT rac.id::text,rac.taxi_rank_id::text,rac.association_label,
            rac.verification_status::text,rac.first_seen_at,rac.last_seen_at,
            r.canonical_name AS rank_name,r.province,r.district,r.municipality,r.town,
            s.source_key,s.source_name,s.authority
       FROM rank_association_candidate rac
       JOIN taxi_rank r ON r.id=rac.taxi_rank_id
       JOIN source_registry s ON s.id=rac.source_id
       ORDER BY rac.last_seen_at DESC,rac.id`
  );
  return {rows:fallback.rows.filter(row=>basicNormalize(row.association_label)===exactKey)};
}

export async function resolveAssociationIdentity(pool,{
  label,
  province=null,
  region=null,
  officialEvidence=[],
  linkedRouteCodes=[]
}={}){
  if(!pool) return null;
  const requested=String(label||'').trim();
  if(!requested) return {status:'invalid',reason:'association_label_required'};

  const exactKey=basicNormalize(requested);
  const variantKey=deterministicVariantNormalize(requested);

  const associations=await pool.query(
    `SELECT id::text,canonical_name,acronym,
            coalesce(to_jsonb(taxi_association)->'aliases','[]'::jsonb) AS aliases,
            registration_number,province,district,municipality,address,
            verification_status::text
       FROM taxi_association
       WHERE coalesce(to_jsonb(taxi_association)->>'merged_into_association_id','')=''
       ORDER BY canonical_name`
  );

  const exactMatches=[];
  const variantMatches=[];
  for(const row of associations.rows){
    const identities=[
      {kind:'canonical_name',value:row.canonical_name},
      {kind:'acronym',value:row.acronym},
      ...((row.aliases||[]).map(value=>({kind:'alias',value})))
    ].filter(item=>item.value);

    for(const identity of identities){
      const candidate={
        id:row.id,
        canonicalName:row.canonical_name,
        acronym:row.acronym,
        aliases:row.aliases||[],
        registrationNumber:row.registration_number,
        province:row.province,
        district:row.district,
        municipality:row.municipality,
        address:row.address,
        verificationStatus:row.verification_status,
        matchedBy:identity.kind,
        matchedValue:identity.value
      };
      if(basicNormalize(identity.value)===exactKey) exactMatches.push(candidate);
      else if(deterministicVariantNormalize(identity.value)===variantKey) variantMatches.push(candidate);
    }
  }

  const [candidateEvidence,routeEvidence]=await Promise.all([
    loadRankAssociationCandidateEvidence(pool,requested,exactKey),
    linkedRouteCodes.length
      ? pool.query(
          `SELECT rc.id::text,rc.route_code,rc.origin_rank_id::text,rc.destination_rank_id::text,
                  rc.association_id::text,rc.reconciliation_status,rc.verification_status::text,
                  o.canonical_name AS origin_name,o.province AS origin_province,
                  d.canonical_name AS destination_name,d.province AS destination_province
             FROM route_candidate rc
             LEFT JOIN taxi_rank o ON o.id=rc.origin_rank_id
             LEFT JOIN taxi_rank d ON d.id=rc.destination_rank_id
             WHERE lower(coalesce(rc.route_code,''))=ANY($1::text[])
             ORDER BY rc.route_code,rc.id`,
          [linkedRouteCodes.map(code=>String(code).toLowerCase())]
        )
      : Promise.resolve({rows:[]})
  ]);

  const exact=uniqueById(exactMatches);
  const variants=uniqueById(variantMatches).filter(row=>!exact.some(x=>x.id===row.id));
  const provinceExact=exact.filter(row=>!province || row.province===province);
  const provinceVariants=variants.filter(row=>!province || row.province===province);

  const authoritativeDocuments=officialEvidence.filter(item=>
    ['provincial_operating_licence_gazette','provincial_association_register'].includes(item.evidenceType) &&
    basicNormalize(item.associationLabel)===exactKey
  );
  const distinctEvidenceDates=[...new Set(authoritativeDocuments.map(item=>item.documentDate).filter(Boolean))];

  let status='insufficient_evidence';
  let reason='no_canonical_match_and_insufficient_authoritative_recurrence';
  let canonicalAssociation=null;
  let recommendedAction='collect_more_authoritative_identity_evidence';

  if(provinceExact.length===1){
    status='canonical_identity_resolved_exact';
    reason='one_exact_canonical_or_alias_identity_match';
    canonicalAssociation=provinceExact[0];
    recommendedAction='reclassify_linked_evidence_against_resolved_identity';
  }else if(provinceExact.length>1){
    status='canonical_identity_ambiguous';
    reason='multiple_exact_canonical_identity_matches';
    recommendedAction='manual_duplicate_or_merge_review';
  }else if(provinceVariants.length===1 && distinctEvidenceDates.length>=2){
    status='canonical_identity_variant_review';
    reason='one_deterministic_non_fuzzy_name_variant_plus_repeated_authoritative_evidence';
    canonicalAssociation=provinceVariants[0];
    recommendedAction='review_ADJ4_alias_proposal_for_existing_canonical_association';
  }else if(provinceVariants.length>1){
    status='canonical_identity_variant_ambiguous';
    reason='multiple_deterministic_name_variants';
    recommendedAction='manual_identity_review';
  }else if(distinctEvidenceDates.length>=2){
    status='canonical_identity_evidence_ready';
    reason='repeated_authoritative_exact_label_without_existing_canonical_identity';
    recommendedAction='controlled_canonical_association_creation_required';
  }

  return {
    mode:'national_association_identity_resolution',
    requestedIdentity:{label:requested,province,region,exactKey,variantKey},
    status,
    reason,
    canonicalAssociation,
    matches:{
      exact:provinceExact,
      deterministicVariant:provinceVariants
    },
    supportingEvidence:{
      authoritativeDocumentCount:authoritativeDocuments.length,
      distinctEvidenceDates,
      documents:authoritativeDocuments,
      rankAssociationCandidates:candidateEvidence.rows,
      linkedRouteCandidates:routeEvidence.rows
    },
    policy:{
      fuzzyMatching:false,
      deterministicVariantExpansionOnly:true,
      automaticCanonicalCreation:false,
      automaticAliasPromotion:false,
      canonicalMutation:false
    },
    recommendedAction
  };
}

export { basicNormalize, deterministicVariantNormalize };
