export function routePromotionEnabled(env=process.env){
  return env.OPERATOR_ROUTE_PROMOTION_ENABLED==='true';
}

export async function lockRouteCandidateScope(client,candidateId,originRankId,destinationRankId,associationId){
  const key=[
    'route-promotion',
    candidateId,
    originRankId,
    destinationRankId,
    associationId
  ].join(':');
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
    [key]
  );
}

function geometryEvidenceBlocked(row){
  const evidenceText=[
    row.category,
    row.map_title,
    JSON.stringify(row.provenance || {}),
    JSON.stringify(row.source_payload || {})
  ].filter(Boolean).join(' ').toLowerCase();

  return /(endpoint[_ -]?connector|straight[_ -]?line|demo[_ -]?only|not[_ -]?route[_ -]?path|notroutepath|inferred[_ -]?geometry)/.test(evidenceText);
}

export async function loadRouteCandidatePromotionSnapshot(client,{
  candidateId,
  associationId,
  lock=false
}){
  const candidateResult=await client.query(
    `SELECT
       rc.id::text,
       rc.source_route_geometry_id::text,
       rc.source_id::text,
       rc.external_record_id,
       rc.route_code,
       rc.origin_rank_id::text,
       rc.destination_rank_id::text,
       rc.association_id::text AS candidate_association_id,
       rc.origin_distance_m,
       rc.destination_distance_m,
       rc.reconciliation_status,
       rc.verification_status::text AS candidate_verification_status,
       rc.confidence,
       rc.provenance,
       rc.first_seen_at,
       rc.last_seen_at,
       srg.route_code AS source_geometry_route_code,
       srg.province,
       srg.municipality,
       srg.district,
       srg.category,
       srg.map_title,
       srg.verification_status::text AS geometry_verification_status,
       srg.source_date,
       srg.source_payload,
       srg.first_seen_at AS geometry_first_seen_at,
       srg.last_seen_at AS geometry_last_seen_at,
       srg.promoted_route_id::text,
       ST_IsValid(srg.geometry) AS geometry_valid,
       ST_IsEmpty(srg.geometry) AS geometry_empty,
       ST_NPoints(srg.geometry)::int AS geometry_npoints,
       GeometryType(srg.geometry) AS geometry_type,
       md5(encode(ST_AsEWKB(srg.geometry),'hex')) AS geometry_hash,
       s.id::text AS registry_source_id,
       s.source_key,
       s.source_name,
       s.authority,
       s.source_class::text,
       s.official AS source_official,
       o.canonical_name AS origin_name,
       d.canonical_name AS destination_name,
       a.canonical_name AS candidate_association_name
     FROM route_candidate rc
     JOIN source_route_geometry srg ON srg.id=rc.source_route_geometry_id
     JOIN source_registry s ON s.id=rc.source_id
     JOIN taxi_rank o ON o.id=rc.origin_rank_id
     JOIN taxi_rank d ON d.id=rc.destination_rank_id
     LEFT JOIN taxi_association a ON a.id=rc.association_id
     WHERE rc.id=$1::uuid
     ${lock?'FOR UPDATE OF rc,srg':''}`,
    [candidateId]
  );

  const row=candidateResult.rows[0];
  if(!row) return {error:'route_candidate_not_found'};

  if(lock){
    await lockRouteCandidateScope(
      client,
      row.id,
      row.origin_rank_id,
      row.destination_rank_id,
      associationId
    );
  }

  const associationResult=await client.query(
    `SELECT
       id::text,
       canonical_name,
       acronym,
       aliases,
       registration_number,
       verification_status::text,
       updated_at
     FROM taxi_association
     WHERE id=$1::uuid
     ${lock?'FOR UPDATE':''}`,
    [associationId]
  );
  const association=associationResult.rows[0];
  if(!association) return {error:'taxi_association_not_found'};

  const endpointRelations=await client.query(
    `SELECT
       ra.relationship_id::text,
       ra.taxi_rank_id::text,
       ra.association_id::text,
       ra.verification_status::text,
       a.canonical_name AS association_name
     FROM taxi_rank_association ra
     JOIN taxi_association a ON a.id=ra.association_id
     WHERE ra.taxi_rank_id IN ($1::uuid,$2::uuid)
     ORDER BY ra.taxi_rank_id,ra.association_id`,
    [row.origin_rank_id,row.destination_rank_id]
  );

  const originAssociationIds=[
    ...new Set(endpointRelations.rows
      .filter(item=>item.taxi_rank_id===row.origin_rank_id)
      .map(item=>item.association_id))
  ].sort();
  const destinationAssociationIds=[
    ...new Set(endpointRelations.rows
      .filter(item=>item.taxi_rank_id===row.destination_rank_id)
      .map(item=>item.association_id))
  ].sort();
  const sharedAssociationIds=
    originAssociationIds.filter(id=>destinationAssociationIds.includes(id));

  const duplicates=await client.query(
    `SELECT
       id::text,
       association_id::text,
       origin_rank_id::text,
       destination_rank_id::text,
       source_route_code,
       national_route_code,
       board_route_code,
       verification_status::text,
       geometry_status
     FROM taxi_route
     WHERE (
       association_id=$1::uuid
       AND origin_rank_id=$2::uuid
       AND destination_rank_id=$3::uuid
     )
     OR (
       $4::text IS NOT NULL
       AND association_id=$1::uuid
       AND (
         (source_route_code IS NOT NULL AND normalize_transport_identity_name(source_route_code)=normalize_transport_identity_name($4))
         OR (national_route_code IS NOT NULL AND normalize_transport_identity_name(national_route_code)=normalize_transport_identity_name($4))
         OR (board_route_code IS NOT NULL AND normalize_transport_identity_name(board_route_code)=normalize_transport_identity_name($4))
       )
     )
     ORDER BY id`,
    [associationId,row.origin_rank_id,row.destination_rank_id,row.route_code]
  );

  const existingSourceRecord=await client.query(
    `SELECT
       id::text,
       entity_id::text,
       external_record_id
     FROM source_record
     WHERE source_id=$1::uuid
       AND entity_type='taxi_route'
       AND external_record_id=$2
     LIMIT 1`,
    [row.source_id,row.external_record_id]
  );

  const promotion=await client.query(
    `SELECT
       id::text,
       candidate_id::text,
       source_route_geometry_id::text,
       route_id::text,
       source_record_id::text,
       promoted_by_proposal_id::text,
       promoted_audit_event_id::text,
       promoted_at
     FROM route_candidate_promotion
     WHERE candidate_id=$1::uuid
        OR source_route_geometry_id=$2::uuid
     ORDER BY promoted_at
     LIMIT 1`,
    [row.id,row.source_route_geometry_id]
  );

  return {
    candidate:{
      id:row.id,
      sourceRouteGeometryId:row.source_route_geometry_id,
      sourceId:row.source_id,
      externalRecordId:row.external_record_id,
      routeCode:row.route_code,
      originRankId:row.origin_rank_id,
      originName:row.origin_name,
      destinationRankId:row.destination_rank_id,
      destinationName:row.destination_name,
      candidateAssociationId:row.candidate_association_id,
      candidateAssociationName:row.candidate_association_name,
      originDistanceM:Number(row.origin_distance_m),
      destinationDistanceM:Number(row.destination_distance_m),
      reconciliationStatus:row.reconciliation_status,
      verificationStatus:row.candidate_verification_status,
      confidence:Number(row.confidence),
      provenance:row.provenance || {},
      firstSeenAt:row.first_seen_at,
      lastSeenAt:row.last_seen_at
    },
    sourceGeometry:{
      id:row.source_route_geometry_id,
      routeCode:row.source_geometry_route_code,
      province:row.province,
      municipality:row.municipality,
      district:row.district,
      category:row.category,
      mapTitle:row.map_title,
      verificationStatus:row.geometry_verification_status,
      sourceDate:row.source_date,
      sourcePayload:row.source_payload || {},
      firstSeenAt:row.geometry_first_seen_at,
      lastSeenAt:row.geometry_last_seen_at,
      promotedRouteId:row.promoted_route_id,
      geometryValid:row.geometry_valid,
      geometryEmpty:row.geometry_empty,
      geometryNPoints:row.geometry_npoints,
      geometryType:row.geometry_type,
      geometryHash:row.geometry_hash,
      evidenceOnly:geometryEvidenceBlocked(row)
    },
    source:{
      id:row.registry_source_id,
      key:row.source_key,
      name:row.source_name,
      authority:row.authority,
      sourceClass:row.source_class,
      official:row.source_official
    },
    association:{
      id:association.id,
      canonicalName:association.canonical_name,
      acronym:association.acronym,
      aliases:association.aliases || [],
      registrationNumber:association.registration_number,
      verificationStatus:association.verification_status,
      updatedAt:association.updated_at
    },
    endpointRelationships:endpointRelations.rows.map(item=>({
      relationshipId:item.relationship_id,
      taxiRankId:item.taxi_rank_id,
      associationId:item.association_id,
      verificationStatus:item.verification_status,
      associationName:item.association_name
    })),
    originAssociationIds,
    destinationAssociationIds,
    sharedAssociationIds,
    existingSourceRecord:existingSourceRecord.rows[0] || null,
    duplicates:duplicates.rows.map(item=>({
      id:item.id,
      associationId:item.association_id,
      originRankId:item.origin_rank_id,
      destinationRankId:item.destination_rank_id,
      sourceRouteCode:item.source_route_code,
      nationalRouteCode:item.national_route_code,
      boardRouteCode:item.board_route_code,
      verificationStatus:item.verification_status,
      geometryStatus:item.geometry_status
    })),
    existingPromotion:promotion.rows[0] || null
  };
}

export function validateRoutePromotionSnapshot(snapshot,associationId){
  if(snapshot.error) return {ok:false,error:snapshot.error};

  const candidate=snapshot.candidate;
  const geometry=snapshot.sourceGeometry;

  if(candidate.reconciliationStatus!=='exact_endpoint_pair'){
    return {ok:false,error:'route_candidate_endpoint_reconciliation_invalid'};
  }

  if(candidate.originRankId===candidate.destinationRankId){
    return {ok:false,error:'route_candidate_endpoints_not_distinct'};
  }

  if(candidate.candidateAssociationId && candidate.candidateAssociationId!==associationId){
    return {
      ok:false,
      error:'route_candidate_association_conflict',
      candidateAssociationId:candidate.candidateAssociationId,
      selectedAssociationId:associationId
    };
  }

  if(!snapshot.sharedAssociationIds.includes(associationId)){
    return {
      ok:false,
      error:'route_candidate_association_not_shared_by_endpoints',
      originAssociationIds:snapshot.originAssociationIds,
      destinationAssociationIds:snapshot.destinationAssociationIds,
      sharedAssociationIds:snapshot.sharedAssociationIds
    };
  }

  if(snapshot.sharedAssociationIds.length!==1){
    return {
      ok:false,
      error:'route_candidate_endpoint_association_conflict',
      sharedAssociationIds:snapshot.sharedAssociationIds
    };
  }

  if(geometry.promotedRouteId || snapshot.existingPromotion){
    return {ok:false,error:'route_candidate_already_promoted'};
  }

  if(snapshot.existingSourceRecord){
    return {
      ok:false,
      error:'route_candidate_source_record_already_canonical',
      canonicalRouteId:snapshot.existingSourceRecord.entity_id
    };
  }

  if(!geometry.geometryValid || geometry.geometryEmpty || geometry.geometryNPoints<2){
    return {ok:false,error:'route_candidate_geometry_invalid'};
  }

  if(!['MULTILINESTRING','ST_MultiLineString'].includes(geometry.geometryType)){
    return {
      ok:false,
      error:'route_candidate_geometry_type_invalid',
      geometryType:geometry.geometryType
    };
  }

  if(geometry.evidenceOnly){
    return {ok:false,error:'route_candidate_geometry_evidence_only'};
  }

  if(!['official','verified','documented','community_verified'].includes(geometry.verificationStatus)){
    return {
      ok:false,
      error:'route_candidate_geometry_verification_ineligible',
      geometryVerificationStatus:geometry.verificationStatus
    };
  }

  if(!['official','verified','documented','community_verified'].includes(candidate.verificationStatus)){
    return {
      ok:false,
      error:'route_candidate_verification_ineligible',
      candidateVerificationStatus:candidate.verificationStatus
    };
  }

  const exactDuplicate=snapshot.duplicates.find(item=>
    item.associationId===associationId &&
    item.originRankId===candidate.originRankId &&
    item.destinationRankId===candidate.destinationRankId
  );
  if(exactDuplicate){
    return {
      ok:false,
      error:'canonical_route_endpoint_duplicate',
      canonicalRouteId:exactDuplicate.id
    };
  }

  if(candidate.routeCode){
    const codeDuplicate=snapshot.duplicates.find(item=>
      !(
        item.associationId===associationId &&
        item.originRankId===candidate.originRankId &&
        item.destinationRankId===candidate.destinationRankId
      )
    );
    if(codeDuplicate){
      return {
        ok:false,
        error:'canonical_route_code_collision',
        canonicalRouteId:codeDuplicate.id
      };
    }
  }

  return {ok:true};
}

export async function insertCanonicalRoute(client,snapshot,associationId){
  const candidate=snapshot.candidate;
  const geometry=snapshot.sourceGeometry;
  const geometryStatus=
    snapshot.source.official && geometry.verificationStatus==='official'
      ? 'official_source'
      : 'source_documented';

  const result=await client.query(
    `INSERT INTO taxi_route (
       association_id,
       origin_rank_id,
       destination_rank_id,
       origin_label,
       destination_label,
       route_name,
       source_route_code,
       route_type,
       geometry,
       geometry_status,
       distance_km,
       verification_status,
       confidence
     )
     SELECT
       $1::uuid,
       $2::uuid,
       $3::uuid,
       $4,
       $5,
       NULLIF($6,''),
       NULLIF($7,''),
       NULLIF($8,''),
       srg.geometry,
       $9,
       round((ST_Length(srg.geometry::geography)/1000.0)::numeric,3),
       $10::verification_status,
       $11
     FROM source_route_geometry srg
     WHERE srg.id=$12::uuid
     RETURNING
       id::text,
       association_id::text,
       origin_rank_id::text,
       destination_rank_id::text,
       origin_label,
       destination_label,
       route_name,
       source_route_code,
       route_type,
       geometry_status,
       distance_km,
       verification_status::text,
       confidence,
       created_at,
       updated_at`,
    [
      associationId,
      candidate.originRankId,
      candidate.destinationRankId,
      candidate.originName,
      candidate.destinationName,
      geometry.mapTitle,
      candidate.routeCode,
      geometry.category,
      geometryStatus,
      candidate.verificationStatus,
      candidate.confidence,
      geometry.id
    ]
  );

  return result.rows[0];
}

export async function insertRouteSourceRecord(client,{
  snapshot,
  route,
  proposalId
}){
  const result=await client.query(
    `INSERT INTO source_record (
       source_id,
       entity_type,
       entity_id,
       external_record_id,
       source_payload,
       source_geometry,
       source_retrieved_at,
       source_last_checked_at,
       source_confidence,
       checksum
     )
     SELECT
       $1::uuid,
       'taxi_route',
       $2::uuid,
       $3,
       $4::jsonb,
       srg.geometry,
       coalesce(srg.first_seen_at,now()),
       srg.last_seen_at,
       $5,
       $6
     FROM source_route_geometry srg
     WHERE srg.id=$7::uuid
     RETURNING id::text`,
    [
      snapshot.source.id,
      route.id,
      snapshot.candidate.externalRecordId,
      JSON.stringify({
        routeCandidateId:snapshot.candidate.id,
        sourceRouteGeometryId:snapshot.sourceGeometry.id,
        proposalId,
        routeCode:snapshot.candidate.routeCode,
        provenance:snapshot.candidate.provenance,
        sourcePayload:snapshot.sourceGeometry.sourcePayload
      }),
      snapshot.candidate.confidence,
      snapshot.sourceGeometry.geometryHash,
      snapshot.sourceGeometry.id
    ]
  );
  return result.rows[0];
}

export async function markSourceGeometryPromoted(client,sourceRouteGeometryId,routeId){
  const result=await client.query(
    `UPDATE source_route_geometry
     SET promoted_route_id=$2::uuid
     WHERE id=$1::uuid
       AND promoted_route_id IS NULL
     RETURNING id::text,promoted_route_id::text`,
    [sourceRouteGeometryId,routeId]
  );
  return result.rows[0] || null;
}

export async function registerRouteCandidatePromotion(client,{
  snapshot,
  routeId,
  sourceRecordId,
  proposalId,
  auditEventId
}){
  const result=await client.query(
    `INSERT INTO route_candidate_promotion (
       candidate_id,
       source_route_geometry_id,
       route_id,
       source_record_id,
       promoted_by_proposal_id,
       promoted_audit_event_id
     ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid)
     RETURNING
       id::text,
       candidate_id::text,
       source_route_geometry_id::text,
       route_id::text,
       source_record_id::text,
       promoted_by_proposal_id::text,
       promoted_audit_event_id::text,
       promoted_at`,
    [
      snapshot.candidate.id,
      snapshot.sourceGeometry.id,
      routeId,
      sourceRecordId,
      proposalId,
      auditEventId
    ]
  );
  return result.rows[0];
}
