export function rankMergeEnabled(env=process.env){
  return env.OPERATOR_RANK_MERGE_ENABLED==='true';
}

async function normalizeNames(client,values){
  if(!values.length) return [];
  const result=await client.query(
    `SELECT value,normalize_transport_identity_name(value) AS normalized
     FROM unnest($1::text[]) value`,
    [values]
  );
  return result.rows.map(row=>({value:row.value,normalized:row.normalized}));
}

async function loadRank(client,id,{forUpdate=false}={}){
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
       rank_type,
       ownership,
       formal_status,
       service_types,
       google_place_id,
       CASE WHEN location IS NULL THEN NULL ELSE ST_X(location) END AS lng,
       CASE WHEN location IS NULL THEN NULL ELSE ST_Y(location) END AS lat,
       CASE WHEN location IS NULL THEN NULL ELSE md5(encode(ST_AsEWKB(location),'hex')) END AS location_hash,
       verification_status::text,
       confidence,
       last_verified_at,
       created_at,
       updated_at,
       (to_jsonb(taxi_rank)->>'merged_into_rank_id') AS merged_into_rank_id,
       (to_jsonb(taxi_rank)->>'merged_at') AS merged_at,
       (to_jsonb(taxi_rank)->>'merge_proposal_id') AS merge_proposal_id,
       (to_jsonb(taxi_rank)->>'merge_audit_event_id') AS merge_audit_event_id
     FROM taxi_rank
     WHERE id=$1::uuid
     ${forUpdate?'FOR UPDATE':''}`,
    [id]
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
    rankType:row.rank_type,
    ownership:row.ownership,
    formalStatus:row.formal_status,
    serviceTypes:row.service_types || [],
    googlePlaceId:row.google_place_id,
    lng:row.lng==null?null:Number(row.lng),
    lat:row.lat==null?null:Number(row.lat),
    locationHash:row.location_hash,
    verificationStatus:row.verification_status,
    confidence:row.confidence==null?null:Number(row.confidence),
    lastVerifiedAt:row.last_verified_at,
    createdAt:row.created_at,
    updatedAt:row.updated_at,
    mergedIntoRankId:row.merged_into_rank_id,
    mergedAt:row.merged_at,
    mergeProposalId:row.merge_proposal_id,
    mergeAuditEventId:row.merge_audit_event_id
  };
}

export async function lockRankMergeScope(client,survivorId,duplicateId){
  const ids=[survivorId,duplicateId].sort();
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
    ['taxi-rank-merge:'+ids[0]+':'+ids[1]]
  );
}

async function loadRelationshipState(client,rankIds){
  const result=await client.query(
    `SELECT
       ra.relationship_id::text,
       ra.taxi_rank_id::text,
       ra.association_id::text,
       ra.verification_status::text,
       ra.confidence,
       a.canonical_name AS association_name,
       EXISTS (
         SELECT 1 FROM rank_association_promotion rap
         WHERE rap.relationship_id=ra.relationship_id
       ) AS has_promotion_lineage
     FROM taxi_rank_association ra
     JOIN taxi_association a ON a.id=ra.association_id
     WHERE ra.taxi_rank_id=ANY($1::uuid[])
     ORDER BY ra.taxi_rank_id,ra.association_id`,
    [rankIds]
  );
  return result.rows.map(row=>({
    relationshipId:row.relationship_id,
    taxiRankId:row.taxi_rank_id,
    associationId:row.association_id,
    associationName:row.association_name,
    verificationStatus:row.verification_status,
    confidence:row.confidence==null?null:Number(row.confidence),
    hasPromotionLineage:row.has_promotion_lineage
  }));
}

async function loadRouteState(client,rankIds){
  const result=await client.query(
    `SELECT
       id::text,
       association_id::text,
       origin_rank_id::text,
       destination_rank_id::text,
       source_route_code,
       national_route_code,
       board_route_code,
       route_name,
       geometry_status,
       verification_status::text,
       CASE WHEN geometry IS NULL THEN NULL ELSE md5(encode(ST_AsEWKB(geometry),'hex')) END AS geometry_hash
     FROM taxi_route
     WHERE origin_rank_id=ANY($1::uuid[])
        OR destination_rank_id=ANY($1::uuid[])
     ORDER BY id`,
    [rankIds]
  );
  return result.rows.map(row=>({
    id:row.id,
    associationId:row.association_id,
    originRankId:row.origin_rank_id,
    destinationRankId:row.destination_rank_id,
    sourceRouteCode:row.source_route_code,
    nationalRouteCode:row.national_route_code,
    boardRouteCode:row.board_route_code,
    routeName:row.route_name,
    geometryStatus:row.geometry_status,
    verificationStatus:row.verification_status,
    geometryHash:row.geometry_hash
  }));
}

async function loadSourceEvidence(client,rankIds){
  const [assoc,dest,routeCandidates,sourceRecords,issues,aliases,pending]=await Promise.all([
    client.query(
      `SELECT id::text,source_id::text,source_rank_external_id,taxi_rank_id::text,
              association_label,normalized_label,verification_status::text,first_seen_at,last_seen_at
       FROM rank_association_candidate
       WHERE taxi_rank_id=ANY($1::uuid[])
       ORDER BY id`,
      [rankIds]
    ),
    client.query(
      `SELECT id::text,source_id::text,source_rank_external_id,taxi_rank_id::text,
              destination_label,normalized_label,verification_status::text,first_seen_at,last_seen_at
       FROM rank_destination_candidate
       WHERE taxi_rank_id=ANY($1::uuid[])
       ORDER BY id`,
      [rankIds]
    ),
    client.query(
      `SELECT id::text,origin_rank_id::text,destination_rank_id::text,association_id::text,
              route_code,reconciliation_status,verification_status::text,provenance,first_seen_at,last_seen_at
       FROM route_candidate
       WHERE origin_rank_id=ANY($1::uuid[]) OR destination_rank_id=ANY($1::uuid[])
       ORDER BY id`,
      [rankIds]
    ),
    client.query(
      `SELECT id::text,source_id::text,entity_id::text,external_record_id,source_payload,
              source_confidence,checksum,source_retrieved_at,source_last_checked_at
       FROM source_record
       WHERE entity_type='taxi_rank' AND entity_id=ANY($1::uuid[])
       ORDER BY id`,
      [rankIds]
    ),
    client.query(
      `SELECT id::text,entity_id::text,issue_type,severity,summary,detail,status,created_at,resolved_at
       FROM data_issue
       WHERE entity_type='taxi_rank' AND entity_id=ANY($1::uuid[])
       ORDER BY id`,
      [rankIds]
    ),
    client.query(
      `SELECT id::text,entity_id::text,alias,normalized_alias,promoted_by_proposal_id::text,
              promoted_audit_event_id::text,created_at
       FROM transport_entity_alias
       WHERE entity_type='taxi_rank' AND entity_id=ANY($1::uuid[])
       ORDER BY normalized_alias,id`,
      [rankIds]
    ),
    client.query(
      `SELECT id::text,target_entity_id::text,action,status,proposer_subject,proposed_at
       FROM operator_decision_proposal
       WHERE target_entity_type='taxi_rank'
         AND target_entity_id=ANY($1::uuid[])
         AND status='proposed'
       ORDER BY proposed_at,id`,
      [rankIds]
    )
  ]);

  return {
    rankAssociationCandidates:assoc.rows,
    rankDestinationCandidates:dest.rows,
    routeCandidates:routeCandidates.rows,
    sourceRecords:sourceRecords.rows,
    dataIssues:issues.rows,
    promotedAliases:aliases.rows,
    pendingProposals:pending.rows
  };
}

async function loadMergeLineage(client,rankIds){
  const result=await client.query(
    `SELECT id::text,survivor_rank_id::text,duplicate_rank_id::text,proposal_id::text,
            merge_audit_event_id::text,merged_at
     FROM taxi_rank_merge_lineage
     WHERE survivor_rank_id=ANY($1::uuid[]) OR duplicate_rank_id=ANY($1::uuid[])
     ORDER BY merged_at,id`,
    [rankIds]
  );
  return result.rows;
}

async function findThirdPartyAliasConflicts(client,survivorId,duplicateId,names){
  const normalized=await normalizeNames(client,names);
  const keys=[...new Set(normalized.map(item=>item.normalized).filter(Boolean))];
  if(!keys.length) return [];

  const result=await client.query(
    `WITH requested AS (
       SELECT unnest($1::text[]) AS normalized
     )
     SELECT DISTINCT
       requested.normalized,
       r.id::text AS entity_id,
       r.canonical_name,
       CASE
         WHEN normalize_transport_identity_name(r.canonical_name)=requested.normalized THEN 'canonical_name'
         ELSE 'legacy_alias'
       END AS collision_kind
     FROM requested
     JOIN taxi_rank r
       ON r.id<>$2::uuid
      AND r.id<>$3::uuid
      AND (
        normalize_transport_identity_name(r.canonical_name)=requested.normalized
        OR EXISTS (
          SELECT 1 FROM unnest(coalesce(r.aliases,ARRAY[]::text[])) value
          WHERE normalize_transport_identity_name(value)=requested.normalized
        )
      )
     WHERE coalesce(to_jsonb(r)->>'merged_into_rank_id','')=''
     UNION
     SELECT DISTINCT
       requested.normalized,
       tea.entity_id::text,
       NULL::text AS canonical_name,
       'promoted_alias'::text AS collision_kind
     FROM requested
     JOIN transport_entity_alias tea
       ON tea.entity_type='taxi_rank'
      AND tea.normalized_alias=requested.normalized
      AND tea.entity_id<>$2::uuid
      AND tea.entity_id<>$3::uuid
     ORDER BY normalized,entity_id`,
    [keys,survivorId,duplicateId]
  );
  return result.rows;
}

async function projectedRouteConflicts(client,survivorId,duplicateId){
  const selfLoops=await client.query(
    `SELECT id::text
     FROM taxi_route
     WHERE (origin_rank_id=$1::uuid AND destination_rank_id=$2::uuid)
        OR (origin_rank_id=$2::uuid AND destination_rank_id=$1::uuid)
     ORDER BY id`,
    [survivorId,duplicateId]
  );

  const duplicates=await client.query(
    `WITH projected AS (
       SELECT
         id,
         association_id,
         CASE WHEN origin_rank_id=$2::uuid THEN $1::uuid ELSE origin_rank_id END AS projected_origin,
         CASE WHEN destination_rank_id=$2::uuid THEN $1::uuid ELSE destination_rank_id END AS projected_destination,
         (origin_rank_id=$2::uuid OR destination_rank_id=$2::uuid) AS touches_duplicate
       FROM taxi_route
     )
     SELECT p1.id::text AS route_id,p2.id::text AS conflicts_with_route_id
     FROM projected p1
     JOIN projected p2
       ON p1.id<p2.id
      AND p1.association_id IS NOT DISTINCT FROM p2.association_id
      AND p1.projected_origin IS NOT DISTINCT FROM p2.projected_origin
      AND p1.projected_destination IS NOT DISTINCT FROM p2.projected_destination
      AND (p1.touches_duplicate OR p2.touches_duplicate)
     ORDER BY p1.id,p2.id`,
    [survivorId,duplicateId]
  );

  return {
    selfLoopRouteIds:selfLoops.rows.map(row=>row.id),
    duplicateRoutes:duplicates.rows
  };
}

export async function buildTaxiRankMergeSnapshot(client,{
  survivorRankId,
  duplicateRankId,
  lock=false,
  excludeProposalId=null
}){
  if(survivorRankId===duplicateRankId) return {error:'rank_merge_same_entity'};

  if(lock) await lockRankMergeScope(client,survivorRankId,duplicateRankId);

  const survivor=await loadRank(client,survivorRankId,{forUpdate:lock});
  const duplicate=await loadRank(client,duplicateRankId,{forUpdate:lock});
  if(!survivor || !duplicate) return {error:'rank_merge_target_not_found'};

  const rankIds=[survivorRankId,duplicateRankId];
  const [relationships,routes,evidence,lineage,routeConflicts]=await Promise.all([
    loadRelationshipState(client,rankIds),
    loadRouteState(client,rankIds),
    loadSourceEvidence(client,rankIds),
    loadMergeLineage(client,rankIds),
    projectedRouteConflicts(client,survivorRankId,duplicateRankId)
  ]);

  if(excludeProposalId){
    evidence.pendingProposals=evidence.pendingProposals.filter(item=>item.id!==excludeProposalId);
  }

  const transferNames=[duplicate.canonicalName,...duplicate.aliases].filter(Boolean);
  const aliasConflicts=await findThirdPartyAliasConflicts(
    client,survivorRankId,duplicateRankId,transferNames
  );

  const duplicateRelationships=relationships.filter(item=>item.taxiRankId===duplicateRankId);
  const survivorAssociationIds=new Set(
    relationships.filter(item=>item.taxiRankId===survivorRankId).map(item=>item.associationId)
  );

  return {
    survivor,
    duplicate,
    relationships,
    routes,
    evidence,
    lineage,
    transferNames,
    aliasConflicts,
    duplicateRelationshipPromotionIds:duplicateRelationships
      .filter(item=>item.hasPromotionLineage)
      .map(item=>item.relationshipId),
    overlappingAssociationIds:duplicateRelationships
      .filter(item=>survivorAssociationIds.has(item.associationId))
      .map(item=>item.associationId)
      .sort(),
    routeConflicts
  };
}

export function validateTaxiRankMergeSnapshot(snapshot){
  if(snapshot.error) return {ok:false,error:snapshot.error};
  if(snapshot.survivor.mergedIntoRankId){
    return {ok:false,error:'rank_merge_survivor_is_tombstone',mergedIntoRankId:snapshot.survivor.mergedIntoRankId};
  }
  if(snapshot.duplicate.mergedIntoRankId){
    return {ok:false,error:'rank_merge_duplicate_already_merged',mergedIntoRankId:snapshot.duplicate.mergedIntoRankId};
  }
  if(snapshot.lineage.some(item=>item.duplicate_rank_id===snapshot.duplicate.id)){
    return {ok:false,error:'rank_merge_duplicate_already_merged'};
  }
  if(snapshot.evidence.pendingProposals.length){
    return {
      ok:false,
      error:'rank_merge_pending_proposal_conflict',
      proposalIds:snapshot.evidence.pendingProposals.map(item=>item.id)
    };
  }
  if(snapshot.survivor.googlePlaceId && snapshot.duplicate.googlePlaceId &&
     snapshot.survivor.googlePlaceId!==snapshot.duplicate.googlePlaceId){
    return {
      ok:false,
      error:'rank_merge_google_place_conflict',
      survivorGooglePlaceId:snapshot.survivor.googlePlaceId,
      duplicateGooglePlaceId:snapshot.duplicate.googlePlaceId
    };
  }
  if(snapshot.aliasConflicts.length){
    return {ok:false,error:'rank_merge_alias_collision',collisions:snapshot.aliasConflicts};
  }
  if(snapshot.duplicateRelationshipPromotionIds.length){
    return {
      ok:false,
      error:'rank_merge_promoted_relationship_conflict',
      relationshipIds:snapshot.duplicateRelationshipPromotionIds
    };
  }
  if(snapshot.routeConflicts.selfLoopRouteIds.length){
    return {
      ok:false,
      error:'rank_merge_route_self_loop_conflict',
      routeIds:snapshot.routeConflicts.selfLoopRouteIds
    };
  }
  if(snapshot.routeConflicts.duplicateRoutes.length){
    return {
      ok:false,
      error:'rank_merge_route_duplicate_conflict',
      conflicts:snapshot.routeConflicts.duplicateRoutes
    };
  }
  return {ok:true};
}

export async function applyTaxiRankMerge(client,{
  snapshot,
  proposalId,
  auditEventId
}){
  const survivorId=snapshot.survivor.id;
  const duplicateId=snapshot.duplicate.id;

  const survivorNames=await normalizeNames(
    client,
    [snapshot.survivor.canonicalName,...snapshot.survivor.aliases]
  );
  const seen=new Set(survivorNames.map(item=>item.normalized));
  const transferred=[];

  for(const item of await normalizeNames(client,snapshot.transferNames)){
    if(!item.normalized || seen.has(item.normalized)) continue;
    seen.add(item.normalized);
    transferred.push(item.value.trim().replace(/\s+/g,' '));
  }

  if(transferred.length){
    await client.query(
      `UPDATE taxi_rank
       SET aliases=aliases || $2::text[],
           updated_at=now()
       WHERE id=$1::uuid`,
      [survivorId,transferred]
    );
  }

  const movedPromotedAliases=await client.query(
    `UPDATE transport_entity_alias
     SET entity_id=$1::uuid
     WHERE entity_type='taxi_rank' AND entity_id=$2::uuid
     RETURNING id::text`,
    [survivorId,duplicateId]
  );

  const overlapDelete=await client.query(
    `DELETE FROM taxi_rank_association d
     WHERE d.taxi_rank_id=$2::uuid
       AND EXISTS (
         SELECT 1 FROM taxi_rank_association s
         WHERE s.taxi_rank_id=$1::uuid
           AND s.association_id=d.association_id
       )
     RETURNING d.relationship_id::text`,
    [survivorId,duplicateId]
  );

  const movedRelationships=await client.query(
    `UPDATE taxi_rank_association
     SET taxi_rank_id=$1::uuid,
         last_seen_at=now()
     WHERE taxi_rank_id=$2::uuid
     RETURNING relationship_id::text`,
    [survivorId,duplicateId]
  );

  const originRoutes=await client.query(
    `UPDATE taxi_route
     SET origin_rank_id=$1::uuid,
         updated_at=now()
     WHERE origin_rank_id=$2::uuid
     RETURNING id::text`,
    [survivorId,duplicateId]
  );
  const destinationRoutes=await client.query(
    `UPDATE taxi_route
     SET destination_rank_id=$1::uuid,
         updated_at=now()
     WHERE destination_rank_id=$2::uuid
     RETURNING id::text`,
    [survivorId,duplicateId]
  );

  const movedIssues=await client.query(
    `UPDATE data_issue
     SET entity_id=$1::uuid
     WHERE entity_type='taxi_rank' AND entity_id=$2::uuid
     RETURNING id::text`,
    [survivorId,duplicateId]
  );

  const counts={
    transferredAliases:transferred.length,
    promotedAliasesRedirected:movedPromotedAliases.rowCount,
    overlappingRelationshipsCollapsed:overlapDelete.rowCount,
    relationshipsRedirected:movedRelationships.rowCount,
    routeOriginsRedirected:originRoutes.rowCount,
    routeDestinationsRedirected:destinationRoutes.rowCount,
    dataIssuesRedirected:movedIssues.rowCount
  };

  await client.query(
    `UPDATE taxi_rank
     SET merged_into_rank_id=$1::uuid,
         merged_at=now(),
         merge_proposal_id=$3::uuid,
         merge_audit_event_id=$4::uuid,
         updated_at=now()
     WHERE id=$2::uuid
       AND merged_into_rank_id IS NULL`,
    [survivorId,duplicateId,proposalId,auditEventId]
  );

  const survivor=await loadRank(client,survivorId);
  const duplicate=await loadRank(client,duplicateId);

  const lineage=await client.query(
    `INSERT INTO taxi_rank_merge_lineage (
       survivor_rank_id,
       duplicate_rank_id,
       proposal_id,
       merge_audit_event_id,
       survivor_before_state,
       duplicate_before_state,
       after_state,
       redirect_counts
     ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb)
     RETURNING id::text,survivor_rank_id::text,duplicate_rank_id::text,
               proposal_id::text,merge_audit_event_id::text,redirect_counts,merged_at`,
    [
      survivorId,
      duplicateId,
      proposalId,
      auditEventId,
      JSON.stringify(snapshot.survivor),
      JSON.stringify(snapshot.duplicate),
      JSON.stringify({survivor,duplicate}),
      JSON.stringify(counts)
    ]
  );

  const view=await client.query("SELECT to_regclass('rank_connectivity')::text AS rel");
  if(view.rows[0]?.rel){
    await client.query('REFRESH MATERIALIZED VIEW rank_connectivity');
  }

  return {
    survivor,
    duplicate,
    counts,
    lineage:lineage.rows[0]
  };
}
