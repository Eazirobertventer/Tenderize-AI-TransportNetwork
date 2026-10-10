export function associationMergeEnabled(env=process.env){
  return env.OPERATOR_ASSOCIATION_MERGE_ENABLED==='true';
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

async function loadAssociation(client,id,{forUpdate=false}={}){
  const result=await client.query(
    `SELECT
       id::text,
       canonical_name,
       acronym,
       registration_number,
       affiliation,
       province,
       district,
       municipality,
       address,
       aliases,
       phone,
       email,
       verification_status::text,
       confidence,
       last_verified_at,
       created_at,
       updated_at,
       (to_jsonb(taxi_association)->>'merged_into_association_id') AS merged_into_association_id,
       (to_jsonb(taxi_association)->>'merged_at') AS merged_at,
       (to_jsonb(taxi_association)->>'merge_proposal_id') AS merge_proposal_id,
       (to_jsonb(taxi_association)->>'merge_audit_event_id') AS merge_audit_event_id
     FROM taxi_association
     WHERE id=$1::uuid
     ${forUpdate?'FOR UPDATE':''}`,
    [id]
  );
  const row=result.rows[0];
  if(!row) return null;
  return {
    id:row.id,
    canonicalName:row.canonical_name,
    acronym:row.acronym,
    registrationNumber:row.registration_number,
    affiliation:row.affiliation,
    province:row.province,
    district:row.district,
    municipality:row.municipality,
    address:row.address,
    aliases:row.aliases || [],
    phone:row.phone || [],
    email:row.email || [],
    verificationStatus:row.verification_status,
    confidence:row.confidence==null?null:Number(row.confidence),
    lastVerifiedAt:row.last_verified_at,
    createdAt:row.created_at,
    updatedAt:row.updated_at,
    mergedIntoAssociationId:row.merged_into_association_id,
    mergedAt:row.merged_at,
    mergeProposalId:row.merge_proposal_id,
    mergeAuditEventId:row.merge_audit_event_id
  };
}

export async function lockAssociationMergeScope(client,survivorId,duplicateId){
  const ids=[survivorId,duplicateId].sort();
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
    ['taxi-association-merge:'+ids[0]+':'+ids[1]]
  );
}

async function loadRelationshipState(client,associationIds){
  const result=await client.query(
    `SELECT
       ra.relationship_id::text,
       ra.taxi_rank_id::text,
       ra.association_id::text,
       ra.verification_status::text,
       ra.confidence,
       EXISTS (
         SELECT 1 FROM rank_association_promotion rap
         WHERE rap.relationship_id=ra.relationship_id
       ) AS has_promotion_lineage
     FROM taxi_rank_association ra
     WHERE ra.association_id=ANY($1::uuid[])
     ORDER BY ra.association_id,ra.taxi_rank_id`,
    [associationIds]
  );
  return result.rows.map(row=>({
    relationshipId:row.relationship_id,
    taxiRankId:row.taxi_rank_id,
    associationId:row.association_id,
    verificationStatus:row.verification_status,
    confidence:row.confidence==null?null:Number(row.confidence),
    hasPromotionLineage:row.has_promotion_lineage
  }));
}

async function loadRouteState(client,associationIds){
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
     WHERE association_id=ANY($1::uuid[])
     ORDER BY id`,
    [associationIds]
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

async function loadEvidence(client,associationIds){
  const [sourceRecords,issues,aliases,pending,candidates]=await Promise.all([
    client.query(
      `SELECT id::text,source_id::text,entity_id::text,external_record_id,source_payload,
              source_confidence,checksum,source_retrieved_at,source_last_checked_at
       FROM source_record
       WHERE entity_type='taxi_association' AND entity_id=ANY($1::uuid[])
       ORDER BY id`,
      [associationIds]
    ),
    client.query(
      `SELECT id::text,entity_id::text,issue_type,severity,summary,detail,status,created_at,resolved_at
       FROM data_issue
       WHERE entity_type='taxi_association' AND entity_id=ANY($1::uuid[])
       ORDER BY id`,
      [associationIds]
    ),
    client.query(
      `SELECT id::text,entity_id::text,alias,normalized_alias,promoted_by_proposal_id::text,
              promoted_audit_event_id::text,created_at
       FROM transport_entity_alias
       WHERE entity_type='taxi_association' AND entity_id=ANY($1::uuid[])
       ORDER BY normalized_alias,id`,
      [associationIds]
    ),
    client.query(
      `SELECT id::text,target_entity_id::text,action,status,proposer_subject,proposed_at
       FROM operator_decision_proposal
       WHERE target_entity_type='taxi_association'
         AND target_entity_id=ANY($1::uuid[])
         AND status='proposed'
       ORDER BY proposed_at,id`,
      [associationIds]
    ),
    client.query(
      `SELECT id::text,association_id::text,route_code,reconciliation_status,verification_status::text,
              origin_rank_id::text,destination_rank_id::text,first_seen_at,last_seen_at
       FROM route_candidate
       WHERE association_id=ANY($1::uuid[])
       ORDER BY id`,
      [associationIds]
    )
  ]);
  return {
    sourceRecords:sourceRecords.rows,
    dataIssues:issues.rows,
    promotedAliases:aliases.rows,
    pendingProposals:pending.rows,
    routeCandidates:candidates.rows
  };
}

async function loadMergeLineage(client,associationIds){
  const exists=await client.query("SELECT to_regclass('taxi_association_merge_lineage')::text AS rel");
  if(!exists.rows[0]?.rel) return [];
  const result=await client.query(
    `SELECT id::text,survivor_association_id::text,duplicate_association_id::text,
            proposal_id::text,merge_audit_event_id::text,merged_at
     FROM taxi_association_merge_lineage
     WHERE survivor_association_id=ANY($1::uuid[]) OR duplicate_association_id=ANY($1::uuid[])
     ORDER BY merged_at,id`,
    [associationIds]
  );
  return result.rows;
}

async function findThirdPartyIdentityConflicts(client,survivorId,duplicateId,names){
  const normalized=await normalizeNames(client,names);
  const keys=[...new Set(normalized.map(item=>item.normalized).filter(Boolean))];
  if(!keys.length) return [];

  const result=await client.query(
    `WITH requested AS (
       SELECT unnest($1::text[]) AS normalized
     )
     SELECT DISTINCT
       requested.normalized,
       a.id::text AS entity_id,
       a.canonical_name,
       CASE
         WHEN normalize_transport_identity_name(a.canonical_name)=requested.normalized THEN 'canonical_name'
         WHEN normalize_transport_identity_name(coalesce(a.acronym,''))=requested.normalized THEN 'acronym'
         ELSE 'legacy_alias'
       END AS collision_kind
     FROM requested
     JOIN taxi_association a
       ON a.id<>$2::uuid
      AND a.id<>$3::uuid
      AND (
        normalize_transport_identity_name(a.canonical_name)=requested.normalized
        OR normalize_transport_identity_name(coalesce(a.acronym,''))=requested.normalized
        OR EXISTS (
          SELECT 1 FROM unnest(coalesce(a.aliases,ARRAY[]::text[])) value
          WHERE normalize_transport_identity_name(value)=requested.normalized
        )
      )
     WHERE coalesce(to_jsonb(a)->>'merged_into_association_id','')=''
     UNION
     SELECT DISTINCT
       requested.normalized,
       tea.entity_id::text,
       NULL::text AS canonical_name,
       'promoted_alias'::text AS collision_kind
     FROM requested
     JOIN transport_entity_alias tea
       ON tea.entity_type='taxi_association'
      AND tea.normalized_alias=requested.normalized
      AND tea.entity_id<>$2::uuid
      AND tea.entity_id<>$3::uuid
     ORDER BY normalized,entity_id`,
    [keys,survivorId,duplicateId]
  );
  return result.rows;
}

async function projectedRouteConflicts(client,survivorId,duplicateId){
  const result=await client.query(
    `WITH projected AS (
       SELECT
         id,
         CASE WHEN association_id=$2::uuid THEN $1::uuid ELSE association_id END AS projected_association,
         origin_rank_id,
         destination_rank_id,
         (association_id=$2::uuid) AS touches_duplicate
       FROM taxi_route
     )
     SELECT p1.id::text AS route_id,p2.id::text AS conflicts_with_route_id
     FROM projected p1
     JOIN projected p2
       ON p1.id<p2.id
      AND p1.projected_association IS NOT DISTINCT FROM p2.projected_association
      AND p1.origin_rank_id IS NOT DISTINCT FROM p2.origin_rank_id
      AND p1.destination_rank_id IS NOT DISTINCT FROM p2.destination_rank_id
      AND (p1.touches_duplicate OR p2.touches_duplicate)
     ORDER BY p1.id,p2.id`,
    [survivorId,duplicateId]
  );
  return result.rows;
}

export async function buildTaxiAssociationMergeSnapshot(client,{
  survivorAssociationId,
  duplicateAssociationId,
  lock=false,
  excludeProposalId=null
}){
  if(survivorAssociationId===duplicateAssociationId) return {error:'association_merge_same_entity'};

  if(lock) await lockAssociationMergeScope(client,survivorAssociationId,duplicateAssociationId);

  const survivor=await loadAssociation(client,survivorAssociationId,{forUpdate:lock});
  const duplicate=await loadAssociation(client,duplicateAssociationId,{forUpdate:lock});
  if(!survivor || !duplicate) return {error:'association_merge_target_not_found'};

  const associationIds=[survivorAssociationId,duplicateAssociationId];
  const [relationships,routes,evidence,lineage,routeConflicts]=await Promise.all([
    loadRelationshipState(client,associationIds),
    loadRouteState(client,associationIds),
    loadEvidence(client,associationIds),
    loadMergeLineage(client,associationIds),
    projectedRouteConflicts(client,survivorAssociationId,duplicateAssociationId)
  ]);

  if(excludeProposalId){
    evidence.pendingProposals=evidence.pendingProposals.filter(item=>item.id!==excludeProposalId);
  }

  const transferNames=[
    duplicate.canonicalName,
    duplicate.acronym,
    ...duplicate.aliases
  ].filter(Boolean);
  const identityConflicts=await findThirdPartyIdentityConflicts(
    client,survivorAssociationId,duplicateAssociationId,transferNames
  );

  const duplicateRelationships=relationships.filter(item=>item.associationId===duplicateAssociationId);
  const survivorRankIds=new Set(
    relationships.filter(item=>item.associationId===survivorAssociationId).map(item=>item.taxiRankId)
  );

  return {
    survivor,
    duplicate,
    relationships,
    routes,
    evidence,
    lineage,
    transferNames,
    identityConflicts,
    duplicateRelationshipPromotionIds:duplicateRelationships
      .filter(item=>item.hasPromotionLineage)
      .map(item=>item.relationshipId),
    overlappingRankIds:duplicateRelationships
      .filter(item=>survivorRankIds.has(item.taxiRankId))
      .map(item=>item.taxiRankId)
      .sort(),
    routeConflicts
  };
}

export function validateTaxiAssociationMergeSnapshot(snapshot){
  if(snapshot.error) return {ok:false,error:snapshot.error};
  if(snapshot.survivor.mergedIntoAssociationId){
    return {ok:false,error:'association_merge_survivor_is_tombstone',mergedIntoAssociationId:snapshot.survivor.mergedIntoAssociationId};
  }
  if(snapshot.duplicate.mergedIntoAssociationId){
    return {ok:false,error:'association_merge_duplicate_already_merged',mergedIntoAssociationId:snapshot.duplicate.mergedIntoAssociationId};
  }
  if(snapshot.lineage.some(item=>item.duplicate_association_id===snapshot.duplicate.id)){
    return {ok:false,error:'association_merge_duplicate_already_merged'};
  }
  if(snapshot.evidence.pendingProposals.length){
    return {ok:false,error:'association_merge_pending_proposal_conflict',proposalIds:snapshot.evidence.pendingProposals.map(item=>item.id)};
  }
  if(snapshot.survivor.registrationNumber && snapshot.duplicate.registrationNumber &&
     snapshot.survivor.registrationNumber!==snapshot.duplicate.registrationNumber){
    return {
      ok:false,
      error:'association_merge_registration_conflict',
      survivorRegistrationNumber:snapshot.survivor.registrationNumber,
      duplicateRegistrationNumber:snapshot.duplicate.registrationNumber
    };
  }
  if(snapshot.identityConflicts.length){
    return {ok:false,error:'association_merge_identity_collision',collisions:snapshot.identityConflicts};
  }
  if(snapshot.duplicateRelationshipPromotionIds.length){
    return {
      ok:false,
      error:'association_merge_promoted_relationship_conflict',
      relationshipIds:snapshot.duplicateRelationshipPromotionIds
    };
  }
  if(snapshot.routeConflicts.length){
    return {ok:false,error:'association_merge_route_duplicate_conflict',conflicts:snapshot.routeConflicts};
  }
  return {ok:true};
}

export async function applyTaxiAssociationMerge(client,{snapshot,proposalId,auditEventId}){
  const survivorId=snapshot.survivor.id;
  const duplicateId=snapshot.duplicate.id;

  const survivorNames=await normalizeNames(
    client,
    [snapshot.survivor.canonicalName,snapshot.survivor.acronym,...snapshot.survivor.aliases].filter(Boolean)
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
      `UPDATE taxi_association
       SET aliases=aliases || $2::text[],
           updated_at=now()
       WHERE id=$1::uuid`,
      [survivorId,transferred]
    );
  }

  const movedPromotedAliases=await client.query(
    `UPDATE transport_entity_alias
     SET entity_id=$1::uuid
     WHERE entity_type='taxi_association' AND entity_id=$2::uuid
     RETURNING id::text`,
    [survivorId,duplicateId]
  );

  const overlapDelete=await client.query(
    `DELETE FROM taxi_rank_association d
     WHERE d.association_id=$2::uuid
       AND EXISTS (
         SELECT 1 FROM taxi_rank_association s
         WHERE s.association_id=$1::uuid
           AND s.taxi_rank_id=d.taxi_rank_id
       )
     RETURNING d.relationship_id::text`,
    [survivorId,duplicateId]
  );

  const movedRelationships=await client.query(
    `UPDATE taxi_rank_association
     SET association_id=$1::uuid,
         last_seen_at=now()
     WHERE association_id=$2::uuid
     RETURNING relationship_id::text`,
    [survivorId,duplicateId]
  );

  const movedRoutes=await client.query(
    `UPDATE taxi_route
     SET association_id=$1::uuid,
         updated_at=now()
     WHERE association_id=$2::uuid
     RETURNING id::text`,
    [survivorId,duplicateId]
  );

  const movedIssues=await client.query(
    `UPDATE data_issue
     SET entity_id=$1::uuid
     WHERE entity_type='taxi_association'
       AND entity_id=$2::uuid
       AND status IN ('open','reviewing','deferred')
     RETURNING id::text`,
    [survivorId,duplicateId]
  );

  const counts={
    transferredAliases:transferred.length,
    promotedAliasesRedirected:movedPromotedAliases.rowCount,
    overlappingRelationshipsCollapsed:overlapDelete.rowCount,
    relationshipsRedirected:movedRelationships.rowCount,
    routesRedirected:movedRoutes.rowCount,
    dataIssuesRedirected:movedIssues.rowCount
  };

  const tombstone=await client.query(
    `UPDATE taxi_association
     SET merged_into_association_id=$1::uuid,
         merged_at=now(),
         merge_proposal_id=$3::uuid,
         merge_audit_event_id=$4::uuid,
         updated_at=now()
     WHERE id=$2::uuid
       AND merged_into_association_id IS NULL
     RETURNING id::text`,
    [survivorId,duplicateId,proposalId,auditEventId]
  );
  if(tombstone.rowCount!==1) throw new Error('association_merge_tombstone_write_failed');

  const survivor=await loadAssociation(client,survivorId);
  const duplicate=await loadAssociation(client,duplicateId);

  const lineage=await client.query(
    `INSERT INTO taxi_association_merge_lineage (
       survivor_association_id,
       duplicate_association_id,
       proposal_id,
       merge_audit_event_id,
       survivor_before_state,
       duplicate_before_state,
       after_state,
       redirect_counts
     ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb)
     RETURNING id::text,survivor_association_id::text,duplicate_association_id::text,
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

  return {survivor,duplicate,counts,lineage:lineage.rows[0]};
}
