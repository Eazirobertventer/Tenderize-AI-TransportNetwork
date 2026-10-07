export function aliasPromotionEnabled(env=process.env){
  return env.OPERATOR_ALIAS_PROMOTION_ENABLED==='true';
}

export function aliasActionForEntityType(entityType){
  if(entityType==='taxi_rank') return 'taxi_rank.alias.add';
  if(entityType==='taxi_association') return 'taxi_association.alias.add';
  return null;
}

export async function normalizeAlias(client,value){
  if(typeof value!=='string') return {ok:false,error:'alias_required'};
  const alias=value.trim().replace(/\s+/g,' ');
  if(alias.length<2 || alias.length>200) return {ok:false,error:'alias_length_invalid'};
  if(/[\u0000-\u001f\u007f]/.test(alias)) return {ok:false,error:'alias_control_character_invalid'};

  const result=await client.query(
    'SELECT normalize_transport_identity_name($1)::text AS normalized_alias',
    [alias]
  );
  const normalizedAlias=result.rows[0]?.normalized_alias || '';
  if(!normalizedAlias || normalizedAlias.length<2){
    return {ok:false,error:'alias_normalization_invalid'};
  }
  return {ok:true,alias,normalizedAlias};
}

export async function loadAliasEntity(client,entityType,entityId,{forUpdate=false}={}){
  if(entityType==='taxi_rank'){
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
      [entityId]
    );
    const row=result.rows[0];
    if(!row) return null;
    return {
      entityType,
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

  if(entityType==='taxi_association'){
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
      [entityId]
    );
    const row=result.rows[0];
    if(!row) return null;
    return {
      entityType,
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

  return null;
}

export async function lockAliasClaim(client,entityType,normalizedAlias){
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
    ['transport-alias:'+entityType+':'+normalizedAlias]
  );
}

export async function findAliasCollision(client,entityType,targetEntityId,normalizedAlias){
  if(entityType==='taxi_rank'){
    const result=await client.query(
      `SELECT id::text,canonical_name,aliases,
         CASE
           WHEN normalize_transport_identity_name(canonical_name)=$1 THEN 'canonical_name'
           ELSE 'alias'
         END AS collision_kind
       FROM taxi_rank
       WHERE normalize_transport_identity_name(canonical_name)=$1
          OR EXISTS (
            SELECT 1
            FROM unnest(coalesce(aliases,ARRAY[]::text[])) value
            WHERE normalize_transport_identity_name(value)=$1
          )
       ORDER BY (id=$2::uuid) DESC,id
       LIMIT 1`,
      [normalizedAlias,targetEntityId]
    );
    const row=result.rows[0];
    if(row){
      return {
        entityType,
        entityId:row.id,
        canonicalName:row.canonical_name,
        kind:row.collision_kind,
        sameTarget:row.id===targetEntityId
      };
    }
  }else if(entityType==='taxi_association'){
    const result=await client.query(
      `SELECT id::text,canonical_name,acronym,aliases,
         CASE
           WHEN normalize_transport_identity_name(canonical_name)=$1 THEN 'canonical_name'
           WHEN acronym IS NOT NULL AND normalize_transport_identity_name(acronym)=$1 THEN 'acronym'
           ELSE 'alias'
         END AS collision_kind
       FROM taxi_association
       WHERE normalize_transport_identity_name(canonical_name)=$1
          OR (acronym IS NOT NULL AND normalize_transport_identity_name(acronym)=$1)
          OR EXISTS (
            SELECT 1
            FROM unnest(coalesce(aliases,ARRAY[]::text[])) value
            WHERE normalize_transport_identity_name(value)=$1
          )
       ORDER BY (id=$2::uuid) DESC,id
       LIMIT 1`,
      [normalizedAlias,targetEntityId]
    );
    const row=result.rows[0];
    if(row){
      return {
        entityType,
        entityId:row.id,
        canonicalName:row.canonical_name,
        kind:row.collision_kind,
        sameTarget:row.id===targetEntityId
      };
    }
  }else{
    return {invalidEntityType:true};
  }

  const registry=await client.query(
    `SELECT entity_id::text,alias,normalized_alias
     FROM transport_entity_alias
     WHERE entity_type=$1
       AND normalized_alias=$2
     LIMIT 1`,
    [entityType,normalizedAlias]
  );
  if(registry.rows[0]){
    return {
      entityType,
      entityId:registry.rows[0].entity_id,
      alias:registry.rows[0].alias,
      kind:'alias_registry',
      sameTarget:registry.rows[0].entity_id===targetEntityId
    };
  }

  return null;
}

export async function addAliasToEntity(client,entityType,entityId,alias){
  if(entityType==='taxi_rank'){
    const result=await client.query(
      `UPDATE taxi_rank
       SET aliases=array_append(aliases,$2),
           updated_at=now()
       WHERE id=$1::uuid
       RETURNING
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
         updated_at`,
      [entityId,alias]
    );
    const row=result.rows[0];
    if(!row) return null;
    return {
      entityType,
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

  if(entityType==='taxi_association'){
    const result=await client.query(
      `UPDATE taxi_association
       SET aliases=array_append(aliases,$2),
           updated_at=now()
       WHERE id=$1::uuid
       RETURNING
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
         updated_at`,
      [entityId,alias]
    );
    const row=result.rows[0];
    if(!row) return null;
    return {
      entityType,
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

  return null;
}

export async function registerPromotedAlias(client,{
  entityType,
  entityId,
  alias,
  normalizedAlias,
  proposalId,
  auditEventId
}){
  const result=await client.query(
    `INSERT INTO transport_entity_alias (
       entity_type,
       entity_id,
       alias,
       normalized_alias,
       promoted_by_proposal_id,
       promoted_audit_event_id
     ) VALUES ($1,$2::uuid,$3,$4,$5::uuid,$6::uuid)
     RETURNING id::text,entity_type,entity_id::text,alias,normalized_alias,created_at`,
    [entityType,entityId,alias,normalizedAlias,proposalId,auditEventId]
  );
  return result.rows[0];
}
