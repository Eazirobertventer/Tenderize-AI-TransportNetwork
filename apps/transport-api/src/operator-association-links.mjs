export function associationAssignmentEnabled(env=process.env){
  return env.OPERATOR_ASSOCIATION_ASSIGNMENT_ENABLED==='true';
}

export async function lockRankAssociationScope(client,rankId){
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
    ['rank-association:'+rankId]
  );
}

export async function loadRankAssociationCandidate(client,candidateId,{forUpdate=false}={}){
  const result=await client.query(
    `SELECT
       rac.id::text,
       rac.source_id::text,
       rac.source_rank_external_id,
       rac.taxi_rank_id::text,
       rac.association_label,
       rac.normalized_label,
       rac.verification_status::text,
       rac.first_seen_at,
       rac.last_seen_at,
       s.source_key,
       s.source_name,
       s.authority
     FROM rank_association_candidate rac
     JOIN source_registry s ON s.id=rac.source_id
     WHERE rac.id=$1::uuid
     ${forUpdate?'FOR UPDATE OF rac':''}`,
    [candidateId]
  );
  const row=result.rows[0];
  if(!row) return null;
  return {
    id:row.id,
    sourceId:row.source_id,
    sourceRankExternalId:row.source_rank_external_id,
    taxiRankId:row.taxi_rank_id,
    associationLabel:row.association_label,
    normalizedLabel:row.normalized_label,
    verificationStatus:row.verification_status,
    firstSeenAt:row.first_seen_at,
    lastSeenAt:row.last_seen_at,
    source:{
      key:row.source_key,
      name:row.source_name,
      authority:row.authority
    }
  };
}

async function loadRank(client,rankId,{forUpdate=false}={}){
  const result=await client.query(
    `SELECT
       id::text,
       canonical_name,
       aliases,
       province,
       district,
       municipality,
       suburb,
       town,
       address,
       verification_status::text,
       updated_at
     FROM taxi_rank
     WHERE id=$1::uuid
     ${forUpdate?'FOR UPDATE':''}`,
    [rankId]
  );
  const row=result.rows[0];
  if(!row) return null;
  return {
    id:row.id,
    canonicalName:row.canonical_name,
    aliases:row.aliases || [],
    province:row.province,
    district:row.district,
    municipality:row.municipality,
    suburb:row.suburb,
    town:row.town,
    address:row.address,
    verificationStatus:row.verification_status,
    updatedAt:row.updated_at
  };
}

async function loadAssociation(client,associationId,{forUpdate=false}={}){
  const result=await client.query(
    `SELECT
       id::text,
       canonical_name,
       acronym,
       aliases,
       registration_number,
       affiliation,
       province,
       district,
       municipality,
       address,
       verification_status::text,
       updated_at
     FROM taxi_association
     WHERE id=$1::uuid
     ${forUpdate?'FOR UPDATE':''}`,
    [associationId]
  );
  const row=result.rows[0];
  if(!row) return null;
  return {
    id:row.id,
    canonicalName:row.canonical_name,
    acronym:row.acronym,
    aliases:row.aliases || [],
    registrationNumber:row.registration_number,
    affiliation:row.affiliation,
    province:row.province,
    district:row.district,
    municipality:row.municipality,
    address:row.address,
    verificationStatus:row.verification_status,
    updatedAt:row.updated_at
  };
}

async function loadRelationships(client,rankId){
  const result=await client.query(
    `SELECT
       ra.relationship_id::text,
       ra.taxi_rank_id::text,
       ra.association_id::text,
       ra.verification_status::text,
       ra.confidence,
       ra.first_seen_at,
       ra.last_seen_at,
       a.canonical_name AS association_name,
       a.acronym AS association_acronym
     FROM taxi_rank_association ra
     JOIN taxi_association a ON a.id=ra.association_id
     WHERE ra.taxi_rank_id=$1::uuid
     ORDER BY ra.association_id,ra.relationship_id`,
    [rankId]
  );
  return result.rows.map(row=>({
    relationshipId:row.relationship_id,
    taxiRankId:row.taxi_rank_id,
    associationId:row.association_id,
    verificationStatus:row.verification_status,
    confidence:row.confidence==null?null:Number(row.confidence),
    firstSeenAt:row.first_seen_at,
    lastSeenAt:row.last_seen_at,
    associationName:row.association_name,
    associationAcronym:row.association_acronym
  }));
}

async function loadCandidateEvidence(client,rankId){
  const result=await client.query(
    `SELECT
       rac.id::text,
       rac.source_id::text,
       rac.source_rank_external_id,
       rac.association_label,
       rac.normalized_label,
       rac.verification_status::text,
       rac.first_seen_at,
       rac.last_seen_at,
       normalize_transport_identity_name(rac.association_label) AS canonical_normalized_label,
       s.source_key,
       s.source_name,
       s.authority
     FROM rank_association_candidate rac
     JOIN source_registry s ON s.id=rac.source_id
     WHERE rac.taxi_rank_id=$1::uuid
     ORDER BY canonical_normalized_label,rac.id`,
    [rankId]
  );
  return result.rows.map(row=>({
    id:row.id,
    sourceId:row.source_id,
    sourceRankExternalId:row.source_rank_external_id,
    associationLabel:row.association_label,
    normalizedLabel:row.normalized_label,
    canonicalNormalizedLabel:row.canonical_normalized_label,
    verificationStatus:row.verification_status,
    firstSeenAt:row.first_seen_at,
    lastSeenAt:row.last_seen_at,
    source:{
      key:row.source_key,
      name:row.source_name,
      authority:row.authority
    }
  }));
}

async function associationIdentitySet(client,association){
  const values=[
    association.canonicalName,
    association.acronym,
    ...(association.aliases || [])
  ].filter(value=>typeof value==='string' && value.trim());
  const result=await client.query(
    `SELECT DISTINCT normalize_transport_identity_name(value) AS normalized
     FROM unnest($1::text[]) value
     ORDER BY normalized`,
    [values]
  );
  return result.rows.map(row=>row.normalized);
}

export async function buildRankAssociationSnapshot(client,{
  candidateId,
  associationId,
  lock=false
}){
  const candidate=await loadRankAssociationCandidate(client,candidateId,{forUpdate:lock});
  if(!candidate) return {error:'rank_association_candidate_not_found'};
  if(!candidate.taxiRankId) return {error:'rank_association_candidate_rank_unresolved'};

  if(lock) await lockRankAssociationScope(client,candidate.taxiRankId);

  const [rank,association,relationships,candidates]=await Promise.all([
    loadRank(client,candidate.taxiRankId,{forUpdate:lock}),
    loadAssociation(client,associationId,{forUpdate:lock}),
    loadRelationships(client,candidate.taxiRankId),
    loadCandidateEvidence(client,candidate.taxiRankId)
  ]);

  if(!rank) return {error:'rank_association_candidate_rank_missing'};
  if(!association) return {error:'taxi_association_not_found'};

  const associationIdentities=await associationIdentitySet(client,association);
  const candidateNormalized=await client.query(
    'SELECT normalize_transport_identity_name($1)::text AS normalized',
    [candidate.associationLabel]
  );
  const candidateIdentity=candidateNormalized.rows[0]?.normalized || null;

  const candidateMatchesAssociation=
    Boolean(candidateIdentity) && associationIdentities.includes(candidateIdentity);

  const competingCandidateLabels=[
    ...new Set(
      candidates
        .map(item=>item.canonicalNormalizedLabel)
        .filter(label=>label && !associationIdentities.includes(label))
    )
  ].sort();

  const existingRelationship=
    relationships.find(item=>item.associationId===associationId) || null;

  const promoted=await client.query(
    `SELECT
       id::text,
       candidate_id::text,
       relationship_id::text,
       taxi_rank_id::text,
       association_id::text,
       promoted_by_proposal_id::text,
       promoted_audit_event_id::text,
       promoted_at
     FROM rank_association_promotion
     WHERE candidate_id=$1::uuid
     LIMIT 1`,
    [candidateId]
  );

  return {
    candidate,
    rank,
    association,
    associationIdentities,
    candidateIdentity,
    candidateMatchesAssociation,
    competingCandidateLabels,
    relationships,
    candidates,
    existingRelationship,
    existingPromotion:promoted.rows[0] || null
  };
}

export function validateRankAssociationSnapshot(snapshot){
  if(snapshot.error) return {ok:false,error:snapshot.error};
  if(snapshot.existingPromotion){
    return {ok:false,error:'rank_association_candidate_already_promoted'};
  }
  if(snapshot.existingRelationship){
    return {ok:false,error:'rank_association_relationship_exists'};
  }
  if(!snapshot.candidateMatchesAssociation){
    return {
      ok:false,
      error:'rank_association_candidate_identity_mismatch',
      candidateIdentity:snapshot.candidateIdentity,
      associationIdentities:snapshot.associationIdentities
    };
  }
  if(snapshot.competingCandidateLabels.length){
    return {
      ok:false,
      error:'rank_association_candidate_conflict',
      competingCandidateLabels:snapshot.competingCandidateLabels
    };
  }
  return {ok:true};
}

export async function insertRankAssociation(client,{
  rankId,
  associationId
}){
  const result=await client.query(
    `INSERT INTO taxi_rank_association (
       taxi_rank_id,
       association_id,
       verification_status,
       confidence
     ) VALUES ($1::uuid,$2::uuid,'verified',NULL)
     RETURNING
       relationship_id::text,
       taxi_rank_id::text,
       association_id::text,
       verification_status::text,
       confidence,
       first_seen_at,
       last_seen_at`,
    [rankId,associationId]
  );
  const row=result.rows[0];
  return {
    relationshipId:row.relationship_id,
    taxiRankId:row.taxi_rank_id,
    associationId:row.association_id,
    verificationStatus:row.verification_status,
    confidence:row.confidence==null?null:Number(row.confidence),
    firstSeenAt:row.first_seen_at,
    lastSeenAt:row.last_seen_at
  };
}

export async function registerRankAssociationPromotion(client,{
  candidateId,
  relationship,
  proposalId,
  auditEventId
}){
  const result=await client.query(
    `INSERT INTO rank_association_promotion (
       candidate_id,
       relationship_id,
       taxi_rank_id,
       association_id,
       promoted_by_proposal_id,
       promoted_audit_event_id
     ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid)
     RETURNING
       id::text,
       candidate_id::text,
       relationship_id::text,
       taxi_rank_id::text,
       association_id::text,
       promoted_by_proposal_id::text,
       promoted_audit_event_id::text,
       promoted_at`,
    [
      candidateId,
      relationship.relationshipId,
      relationship.taxiRankId,
      relationship.associationId,
      proposalId,
      auditEventId
    ]
  );
  return result.rows[0];
}
