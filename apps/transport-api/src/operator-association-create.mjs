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


export async function validateAssociationCreationSourceLineage(client,{
  proposalId,
  canonicalName,
  proposalEvidence,
  approvalEvidence
}){
  const rows=approvalEvidence?.sourceLineage;
  if(!Array.isArray(rows) || rows.length<2){
    return {ok:false,error:'association_creation_source_lineage_required'};
  }

  const proposalUrls=new Set(proposalEvidence?.recurrence?.sourceUrls||[]);
  const proposalDocs=new Set(proposalEvidence?.recurrence?.documentIds||[]);
  const proposalDates=new Set(proposalEvidence?.recurrence?.distinctEvidenceDates||[]);
  const distinctDates=new Set();
  const normalizedName=await normalizeIdentity(client,canonicalName);
  const resolved=[];

  for(const row of rows){
    const sourceKey=String(row?.sourceKey||'').trim();
    const documentId=String(row?.documentId||'').trim();
    const documentDate=String(row?.documentDate||'').trim();
    const sourceUrl=String(row?.sourceUrl||'').trim();
    const checksum=String(row?.checksum||'').trim().toLowerCase();

    if(!sourceKey || !documentId || !documentDate || !sourceUrl || !/^[0-9a-f]{64}$/.test(checksum)){
      return {ok:false,error:'association_creation_source_lineage_invalid'};
    }
    if(!proposalUrls.has(sourceUrl) || !proposalDocs.has(documentId) || !proposalDates.has(documentDate)){
      return {ok:false,error:'association_creation_source_lineage_proposal_mismatch'};
    }

    const source=(await client.query(
      `SELECT id::text,source_key,source_name,authority,source_class::text,source_url
         FROM source_registry
         WHERE source_key=$1
         LIMIT 1`,
      [sourceKey]
    )).rows[0];
    if(!source){
      return {ok:false,error:'association_creation_source_registry_missing',sourceKey};
    }

    distinctDates.add(documentDate);
    resolved.push({
      ...row,
      sourceRegistryId:source.id,
      sourceKey,
      documentId,
      documentDate,
      sourceUrl,
      checksum,
      normalizedAssociationName:normalizedName,
      externalRecordId:documentId+':association:'+normalizedName
    });
  }

  if(distinctDates.size<2){
    return {ok:false,error:'association_creation_source_lineage_recurrence_required'};
  }

  return {ok:true,lineage:resolved};
}

export async function insertAssociationCreationSourceRecords(client,{
  association,
  proposalId,
  lineage
}){
  const records=[];
  for(const row of lineage){
    const result=await client.query(
      `INSERT INTO source_record (
         source_id,entity_type,entity_id,external_record_id,source_payload,
         source_retrieved_at,source_last_checked_at,checksum
       ) VALUES (
         $1::uuid,'taxi_association',$2::uuid,$3,$4::jsonb,now(),now(),$5
       )
       ON CONFLICT (source_id,entity_type,external_record_id)
       DO UPDATE SET
         entity_id=EXCLUDED.entity_id,
         source_payload=EXCLUDED.source_payload,
         source_last_checked_at=now(),
         checksum=EXCLUDED.checksum
       RETURNING id::text,source_id::text,entity_id::text,external_record_id,checksum`,
      [
        row.sourceRegistryId,
        association.id,
        row.externalRecordId,
        JSON.stringify({
          gate:'TN7-NATIONAL-16',
          proposalId,
          documentId:row.documentId,
          documentDate:row.documentDate,
          sourceUrl:row.sourceUrl,
          authority:row.authority||null,
          retrievalMirror:row.retrievalMirror||null,
          associationLabel:association.canonical_name
        }),
        row.checksum
      ]
    );
    records.push(result.rows[0]);
  }
  return records;
}
