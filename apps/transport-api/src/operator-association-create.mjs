export function associationCreationEnabled(env=process.env){
  return env.OPERATOR_ASSOCIATION_CREATE_ENABLED==='true';
}

async function normalizeIdentity(client,value){
  const result=await client.query(
    'SELECT normalize_transport_identity_name($1)::text AS normalized',
    [value]
  );
  return result.rows[0]?.normalized || '';
}

export async function lockAssociationCreationScope(client,canonicalName,registrationNumber){
  const normalized=await normalizeIdentity(client,canonicalName);
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
    ['association-create:name:'+normalized]
  );
  if(registrationNumber){
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      ['association-create:registration:'+String(registrationNumber).trim().toLowerCase()]
    );
  }
  return normalized;
}

export async function buildAssociationCreationSnapshot(client,{
  canonicalName,
  acronym=null,
  registrationNumber=null,
  affiliation=null,
  province,
  district=null,
  municipality=null,
  address=null,
  verificationStatus='documented',
  lock=false
}){
  const name=String(canonicalName||'').trim().replace(/\s+/g,' ');
  const normalizedName=await normalizeIdentity(client,name);
  if(lock) await lockAssociationCreationScope(client,name,registrationNumber);

  const identityCollisions=await client.query(
    `SELECT id::text,canonical_name,acronym,aliases,registration_number,province,
            verification_status::text,
            CASE
              WHEN normalize_transport_identity_name(canonical_name)=$1 THEN 'canonical_name'
              WHEN acronym IS NOT NULL AND normalize_transport_identity_name(acronym)=$1 THEN 'acronym'
              ELSE 'alias'
            END AS collision_kind
       FROM taxi_association
       WHERE coalesce(to_jsonb(taxi_association)->>'merged_into_association_id','')=''
         AND (
           normalize_transport_identity_name(canonical_name)=$1
           OR (acronym IS NOT NULL AND normalize_transport_identity_name(acronym)=$1)
           OR EXISTS (
             SELECT 1 FROM unnest(coalesce(aliases,ARRAY[]::text[])) value
             WHERE normalize_transport_identity_name(value)=$1
           )
         )
       ORDER BY id`,
    [normalizedName]
  );

  const registryCollisions=await client.query(
    `SELECT entity_id::text,alias,normalized_alias
       FROM transport_entity_alias
       WHERE entity_type='taxi_association'
         AND normalized_alias=$1
       ORDER BY entity_id`,
    [normalizedName]
  );

  let registrationCollisions={rows:[]};
  if(registrationNumber){
    registrationCollisions=await client.query(
      `SELECT id::text,canonical_name,registration_number,province
         FROM taxi_association
         WHERE registration_number=$1
           AND coalesce(to_jsonb(taxi_association)->>'merged_into_association_id','')=''
         ORDER BY id`,
      [String(registrationNumber).trim()]
    );
  }

  return {
    proposed:{
      canonicalName:name,
      normalizedName,
      acronym:acronym ? String(acronym).trim() : null,
      registrationNumber:registrationNumber ? String(registrationNumber).trim() : null,
      affiliation:affiliation ? String(affiliation).trim() : null,
      province:String(province||'').trim(),
      district:district ? String(district).trim() : null,
      municipality:municipality ? String(municipality).trim() : null,
      address:address ? String(address).trim() : null,
      verificationStatus
    },
    identityCollisions:identityCollisions.rows,
    promotedAliasCollisions:registryCollisions.rows,
    registrationCollisions:registrationCollisions.rows
  };
}

export function validateAssociationCreationSnapshot(snapshot){
  const p=snapshot?.proposed||{};
  if(!p.canonicalName || p.canonicalName.length<2 || p.canonicalName.length>200){
    return {ok:false,error:'association_canonical_name_invalid'};
  }
  if(!p.normalizedName){
    return {ok:false,error:'association_canonical_name_normalization_invalid'};
  }
  if(!p.province){
    return {ok:false,error:'association_province_required'};
  }
  if(!['documented','verified'].includes(p.verificationStatus)){
    return {ok:false,error:'association_creation_verification_status_invalid'};
  }
  if(snapshot.identityCollisions.length){
    return {ok:false,error:'association_identity_collision',collisions:snapshot.identityCollisions};
  }
  if(snapshot.promotedAliasCollisions.length){
    return {ok:false,error:'association_promoted_alias_collision',collisions:snapshot.promotedAliasCollisions};
  }
  if(snapshot.registrationCollisions.length){
    return {ok:false,error:'association_registration_collision',collisions:snapshot.registrationCollisions};
  }
  return {ok:true};
}

export async function insertCanonicalAssociation(client,snapshot){
  const p=snapshot.proposed;
  const result=await client.query(
    `INSERT INTO taxi_association (
       canonical_name,acronym,registration_number,affiliation,
       province,district,municipality,address,
       verification_status,confidence,last_verified_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9::verification_status,NULL,now()
     )
     RETURNING id::text,canonical_name,acronym,registration_number,affiliation,
               province,district,municipality,address,aliases,
               verification_status::text,confidence,last_verified_at,created_at,updated_at`,
    [
      p.canonicalName,p.acronym,p.registrationNumber,p.affiliation,
      p.province,p.district,p.municipality,p.address,p.verificationStatus
    ]
  );
  return result.rows[0];
}
