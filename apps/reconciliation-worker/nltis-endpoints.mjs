import pg from 'pg';

const { Pool }=pg;
if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const candidateThreshold=Number(process.env.NLTIS_CANDIDATE_SIMILARITY || 0.82);
const candidateMargin=Number(process.env.NLTIS_CANDIDATE_MARGIN || 0.08);

if(!Number.isFinite(candidateThreshold) || candidateThreshold<0.70 || candidateThreshold>1){
  throw new Error('NLTIS_CANDIDATE_SIMILARITY must be between 0.70 and 1');
}
if(!Number.isFinite(candidateMargin) || candidateMargin<0.02 || candidateMargin>0.30){
  throw new Error('NLTIS_CANDIDATE_MARGIN must be between 0.02 and 0.30');
}

const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3,ssl:false});
const client=await pool.connect();

function normalizeLabel(value){
  return String(value || '')
    .toLowerCase()
    .replace(/&/g,' and ')
    .replace(/[^a-z0-9]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function endpointIssueKey(routeId,side){
  return ['nltis-endpoint',routeId,side].join('|');
}

async function exactCanonical(label,province){
  const result=await client.query(
    `SELECT id::text,canonical_name,aliases,province,municipality,town,
            CASE WHEN location IS NULL THEN NULL ELSE ST_X(location) END AS lng,
            CASE WHEN location IS NULL THEN NULL ELSE ST_Y(location) END AS lat
     FROM taxi_rank
     WHERE upper(trim(canonical_name))=upper(trim($1))
       AND ($2::text IS NULL OR province IS NULL OR lower(province)=lower($2))
     ORDER BY id`,
    [label,province || null]
  );
  return result.rows;
}

async function exactAlias(normalized,province){
  if(!normalized) return [];
  const result=await client.query(
    `SELECT
       r.id::text,r.canonical_name,r.aliases,r.province,r.municipality,r.town,
       CASE WHEN r.location IS NULL THEN NULL ELSE ST_X(r.location) END AS lng,
       CASE WHEN r.location IS NULL THEN NULL ELSE ST_Y(r.location) END AS lat
     FROM taxi_rank r
     WHERE EXISTS (
       SELECT 1
       FROM unnest(r.aliases) AS u(alias_value)
       WHERE regexp_replace(
               regexp_replace(lower(trim(alias_value)),'&',' and ','g'),
               '[^a-z0-9]+',' ','g'
             ) = $1::text
     )
       AND ($2::text IS NULL OR r.province IS NULL OR lower(r.province)=lower($2::text))
     ORDER BY r.id`,
    [normalized,province || null]
  );
  return result.rows;
}

async function similarityCandidates(normalized,province){
  if(!normalized) return [];
  const result=await client.query(
    `WITH ranked AS (
       SELECT
         r.id::text,
         r.canonical_name,
         r.aliases,
         r.province,
         r.municipality,
         r.town,
         CASE WHEN r.location IS NULL THEN NULL ELSE ST_X(r.location) END AS lng,
         CASE WHEN r.location IS NULL THEN NULL ELSE ST_Y(r.location) END AS lat,
         GREATEST(
           similarity(
             regexp_replace(
               regexp_replace(lower(trim(r.canonical_name)),'&',' and ','g'),
               '[^a-z0-9]+',' ','g'
             ),
             $1
           ),
           coalesce((
             SELECT max(similarity(
               regexp_replace(
                 regexp_replace(lower(trim(alias_value)),'&',' and ','g'),
                 '[^a-z0-9]+',' ','g'
               ),
               $1
             ))
             FROM unnest(r.aliases) AS a(alias_value)
           ),0)
         ) AS score
       FROM taxi_rank r
       WHERE ($2::text IS NULL OR r.province IS NULL OR lower(r.province)=lower($2))
     )
     SELECT *
     FROM ranked
     WHERE score >= $3::real
     ORDER BY score DESC,canonical_name,id
     LIMIT 8`,
    [normalized,province || null,candidateThreshold]
  );
  return result.rows.map(row=>({...row,score:Number(row.score)}));
}

async function classifyLabel(label,province){
  if(!label) return {classification:'UNRESOLVED',matches:[],normalizedLabel:''};

  const normalizedLabel=normalizeLabel(label);

  const canonical=await exactCanonical(label,province);
  if(canonical.length===1){
    return {classification:'EXACT',matches:canonical,normalizedLabel};
  }
  if(canonical.length>1){
    return {classification:'AMBIGUOUS',matches:canonical,normalizedLabel,reason:'duplicate_exact_canonical'};
  }

  const aliases=await exactAlias(normalizedLabel,province);
  if(aliases.length===1){
    return {classification:'ALIAS',matches:aliases,normalizedLabel};
  }
  if(aliases.length>1){
    return {classification:'AMBIGUOUS',matches:aliases,normalizedLabel,reason:'duplicate_exact_alias'};
  }

  const candidates=await similarityCandidates(normalizedLabel,province);
  if(candidates.length===0){
    return {classification:'UNRESOLVED',matches:[],normalizedLabel};
  }

  const top=candidates[0];
  const runnerUp=candidates[1];
  const margin=runnerUp ? top.score-runnerUp.score : 1;

  if(top.score>=candidateThreshold && margin>=candidateMargin){
    return {
      classification:'HIGH_CONFIDENCE_CANDIDATE',
      matches:candidates,
      normalizedLabel,
      topScore:top.score,
      margin
    };
  }

  return {
    classification:'AMBIGUOUS',
    matches:candidates,
    normalizedLabel,
    reason:'candidate_margin_too_small',
    topScore:top.score,
    margin
  };
}

async function resolveOpenIssue(routeId,side,resolution){
  const key=endpointIssueKey(routeId,side);
  await client.query(
    `UPDATE data_issue
     SET status='resolved',
         resolved_at=now(),
         detail=detail || $2::jsonb
     WHERE issue_type='nltis_endpoint_reconciliation'
       AND detail->>'issueKey'=$1
       AND status IN ('open','reviewing','deferred')`,
    [key,JSON.stringify({resolvedBy:resolution,resolvedAt:new Date().toISOString()})]
  );
}

async function upsertIssue({route,side,label,result,currentRankId}){
  const issueKey=endpointIssueKey(route.id,side);
  const severity=result.classification==='AMBIGUOUS' ? 'warning'
    : result.classification==='HIGH_CONFIDENCE_CANDIDATE' ? 'warning'
    : 'info';

  const detail={
    issueKey,
    routeId:route.id,
    associationId:route.association_id,
    associationName:route.association_name,
    associationRegistration:route.registration_number,
    associationProvince:route.association_province,
    sourceKey:route.source_key,
    side,
    label,
    normalizedLabel:result.normalizedLabel,
    classification:result.classification,
    reason:result.reason || null,
    candidateThreshold,
    candidateMargin,
    topScore:result.topScore ?? null,
    scoreMargin:result.margin ?? null,
    currentRankId:currentRankId || null,
    candidates:result.matches.map(row=>({
      rankId:row.id,
      name:row.canonical_name,
      province:row.province,
      municipality:row.municipality,
      town:row.town,
      coordinates:row.lng==null || row.lat==null ? null : [Number(row.lng),Number(row.lat)],
      score:row.score == null ? null : Number(Number(row.score).toFixed(4))
    })),
    action:result.classification==='HIGH_CONFIDENCE_CANDIDATE'
      ? 'manual_review_required'
      : result.classification==='AMBIGUOUS'
        ? 'manual_disambiguation_required'
        : 'source_enrichment_required',
    autoMerge:false,
    exactAndAliasAutoLinkOnly:true
  };

  const summary='NLTIS endpoint ' + result.classification + ': ' + side + ' ' + label;

  await client.query(
    `INSERT INTO data_issue
      (entity_type,entity_id,issue_type,severity,summary,detail,status)
     SELECT
      'nltis_route_endpoint',$1::uuid,'nltis_endpoint_reconciliation',$2,$3,$4::jsonb,'open'
     WHERE NOT EXISTS (
       SELECT 1
       FROM data_issue
       WHERE issue_type='nltis_endpoint_reconciliation'
         AND detail->>'issueKey'=$5
         AND status IN ('open','reviewing','deferred')
     )`,
    [route.id,severity,summary,JSON.stringify(detail),issueKey]
  );

  await client.query(
    `UPDATE data_issue
     SET severity=$1,
         summary=$2,
         detail=$3::jsonb
     WHERE issue_type='nltis_endpoint_reconciliation'
       AND detail->>'issueKey'=$4
       AND status IN ('open','reviewing','deferred')`,
    [severity,summary,JSON.stringify(detail),issueKey]
  );
}

async function writeDeterministicLink(route,side,currentRankId,rankId,classification){
  if(currentRankId && currentRankId!==rankId){
    const conflict={
      classification:'AMBIGUOUS',
      reason:'existing_link_conflict',
      normalizedLabel:normalizeLabel(side==='origin'?route.origin_label:route.destination_label),
      matches:[{id:rankId,canonical_name:'deterministic candidate'}]
    };
    await upsertIssue({
      route,
      side,
      label:side==='origin'?route.origin_label:route.destination_label,
      result:conflict,
      currentRankId
    });
    return {linked:false,conflict:true};
  }

  if(!currentRankId){
    const column=side==='origin' ? 'origin_rank_id' : 'destination_rank_id';
    await client.query(
      `UPDATE taxi_route SET ${column}=$2::uuid,updated_at=now() WHERE id=$1::uuid`,
      [route.id,rankId]
    );
  }

  await client.query(
    `INSERT INTO taxi_rank_association
      (taxi_rank_id,association_id,verification_status,first_seen_at,last_seen_at)
     VALUES ($1::uuid,$2::uuid,'documented',now(),now())
     ON CONFLICT (taxi_rank_id,association_id) DO UPDATE SET
       verification_status='documented',
       last_seen_at=now()`,
    [rankId,route.association_id]
  );

  await resolveOpenIssue(route.id,side,classification);
  return {linked:!currentRankId,conflict:false};
}

try{
  const routes=await client.query(
    `SELECT DISTINCT
       tr.id::text,
       tr.association_id::text,
       tr.origin_label,
       tr.destination_label,
       tr.origin_rank_id::text,
       tr.destination_rank_id::text,
       a.canonical_name AS association_name,
       a.registration_number,
       a.province AS association_province,
       s.source_key
     FROM taxi_route tr
     JOIN taxi_association a ON a.id=tr.association_id
     JOIN source_record sr
       ON sr.entity_type='taxi_route' AND sr.entity_id=tr.id
     JOIN source_registry s ON s.id=sr.source_id
     WHERE s.source_class='nltis_olas'
       AND tr.verification_status='documented'
     ORDER BY registration_number,id`
  );

  await client.query('BEGIN');

  const summary={
    routes:routes.rows.length,
    endpoints:0,
    exact:0,
    alias:0,
    highConfidenceCandidate:0,
    unresolved:0,
    ambiguous:0,
    deterministicLinksWritten:0,
    candidateLinksWritten:0,
    existingLinkConflicts:0
  };

  for(const route of routes.rows){
    for(const side of ['origin','destination']){
      const label=side==='origin' ? route.origin_label : route.destination_label;
      const currentRankId=side==='origin' ? route.origin_rank_id : route.destination_rank_id;
      const result=await classifyLabel(label,route.association_province);

      summary.endpoints+=1;
      if(result.classification==='EXACT') summary.exact+=1;
      if(result.classification==='ALIAS') summary.alias+=1;
      if(result.classification==='HIGH_CONFIDENCE_CANDIDATE') summary.highConfidenceCandidate+=1;
      if(result.classification==='UNRESOLVED') summary.unresolved+=1;
      if(result.classification==='AMBIGUOUS') summary.ambiguous+=1;

      if(result.classification==='EXACT' || result.classification==='ALIAS'){
        const outcome=await writeDeterministicLink(
          route,side,currentRankId,result.matches[0].id,result.classification
        );
        if(outcome.linked) summary.deterministicLinksWritten+=1;
        if(outcome.conflict) summary.existingLinkConflicts+=1;
      }else{
        await upsertIssue({route,side,label,result,currentRankId});
      }
    }
  }

  await client.query('COMMIT');

  const proof=await client.query(
    `SELECT
       count(*) FILTER (WHERE tr.origin_rank_id IS NOT NULL)::int AS origin_links,
       count(*) FILTER (WHERE tr.destination_rank_id IS NOT NULL)::int AS destination_links,
       (SELECT count(*)::int FROM data_issue
          WHERE issue_type='nltis_endpoint_reconciliation'
            AND status IN ('open','reviewing','deferred')
            AND detail->>'classification'='HIGH_CONFIDENCE_CANDIDATE') AS review_candidates
     FROM taxi_route tr
     JOIN source_record sr
       ON sr.entity_type='taxi_route' AND sr.entity_id=tr.id
     JOIN source_registry s ON s.id=sr.source_id
     WHERE s.source_class='nltis_olas'
       AND tr.verification_status='documented'`
  );

  console.log(JSON.stringify({
    event:'nltis_endpoint_reconciliation_complete',
    policy:{
      autoLink:['EXACT','ALIAS'],
      reviewOnly:['HIGH_CONFIDENCE_CANDIDATE','AMBIGUOUS'],
      noAutoFuzzyMerge:true,
      candidateThreshold,
      candidateMargin
    },
    summary,
    database:proof.rows[0]
  }));
}catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  console.error(JSON.stringify({
    event:'nltis_endpoint_reconciliation_failed',
    error:String(error?.message || error)
  }));
  process.exitCode=1;
}finally{
  client.release();
  await pool.end();
}
