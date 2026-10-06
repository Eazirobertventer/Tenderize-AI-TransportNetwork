import pg from 'pg';

const { Pool }=pg;
if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const candidateThreshold=Number(process.env.NLTIS_CANDIDATE_SIMILARITY || 0.82);
const candidateMargin=Number(process.env.NLTIS_CANDIDATE_MARGIN || 0.08);

const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2,ssl:false});
const client=await pool.connect();

function normalizeLabel(value){
  return String(value || '')
    .toLowerCase()
    .replace(/&/g,' and ')
    .replace(/[^a-z0-9]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

async function exactCanonical(label,province){
  const result=await client.query(
    `SELECT id::text,canonical_name,aliases,province,municipality,town
     FROM taxi_rank
     WHERE upper(trim(canonical_name))=upper(trim($1))
       AND ($2::text IS NULL OR province IS NULL OR lower(province)=lower($2::text))
     ORDER BY id`,
    [label,province || null]
  );
  return result.rows;
}

async function exactAlias(normalized,province){
  if(!normalized) return [];
  const result=await client.query(
    `SELECT r.id::text,r.canonical_name,r.aliases,r.province,r.municipality,r.town
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
         r.province,
         r.municipality,
         r.town,
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
             FROM unnest(r.aliases) AS u(alias_value)
           ),0)
         ) AS score
       FROM taxi_rank r
       WHERE ($2::text IS NULL OR r.province IS NULL OR lower(r.province)=lower($2::text))
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

async function classify(label,province){
  if(!label) return {classification:'UNRESOLVED',matches:[]};

  const normalized=normalizeLabel(label);
  const canonical=await exactCanonical(label,province);
  if(canonical.length===1) return {classification:'EXACT',matches:canonical};
  if(canonical.length>1) return {classification:'AMBIGUOUS',matches:canonical,reason:'duplicate_exact_canonical'};

  const aliases=await exactAlias(normalized,province);
  if(aliases.length===1) return {classification:'ALIAS',matches:aliases};
  if(aliases.length>1) return {classification:'AMBIGUOUS',matches:aliases,reason:'duplicate_exact_alias'};

  const candidates=await similarityCandidates(normalized,province);
  if(candidates.length===0) return {classification:'UNRESOLVED',matches:[]};

  const top=candidates[0];
  const runnerUp=candidates[1];
  const margin=runnerUp ? top.score-runnerUp.score : 1;

  if(top.score>=candidateThreshold && margin>=candidateMargin){
    return {
      classification:'HIGH_CONFIDENCE_CANDIDATE',
      matches:candidates,
      topScore:top.score,
      margin
    };
  }

  return {
    classification:'AMBIGUOUS',
    matches:candidates,
    reason:'candidate_margin_too_small',
    topScore:top.score,
    margin
  };
}

try{
  await client.query('BEGIN READ ONLY');

  const counts=await client.query(
    `SELECT
       (SELECT count(*)::int FROM taxi_rank) AS taxi_ranks,
       (SELECT count(*)::int FROM taxi_association) AS taxi_associations,
       (SELECT count(*)::int FROM taxi_route) AS taxi_routes,
       (SELECT count(*)::int
          FROM taxi_route tr
          JOIN source_record sr ON sr.entity_type='taxi_route' AND sr.entity_id=tr.id
          JOIN source_registry s ON s.id=sr.source_id
          WHERE s.source_class='nltis_olas'
            AND tr.verification_status='documented') AS nltis_routes`
  );

  const routes=await client.query(
    `SELECT DISTINCT
       tr.id::text,
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
     JOIN source_record sr ON sr.entity_type='taxi_route' AND sr.entity_id=tr.id
     JOIN source_registry s ON s.id=sr.source_id
     WHERE s.source_class='nltis_olas'
       AND tr.verification_status='documented'
     ORDER BY a.registration_number,tr.id`
  );

  const summary={
    endpoints:0,
    EXACT:0,
    ALIAS:0,
    HIGH_CONFIDENCE_CANDIDATE:0,
    AMBIGUOUS:0,
    UNRESOLVED:0,
    alreadyLinkedEndpoints:0,
    exactBothEndpointsRoutes:0,
    deterministicBothEndpointsRoutes:0,
    reviewNeededEndpoints:0
  };

  const byAssociation={};
  const sampleCandidates=[];
  const unresolvedSamples=[];
  const ambiguousSamples=[];

  for(const route of routes.rows){
    const routeResults=[];
    for(const side of ['origin','destination']){
      const label=side==='origin' ? route.origin_label : route.destination_label;
      const currentRankId=side==='origin' ? route.origin_rank_id : route.destination_rank_id;
      const result=await classify(label,route.association_province);

      summary.endpoints+=1;
      summary[result.classification]+=1;
      if(currentRankId) summary.alreadyLinkedEndpoints+=1;
      if(['HIGH_CONFIDENCE_CANDIDATE','AMBIGUOUS','UNRESOLVED'].includes(result.classification)){
        summary.reviewNeededEndpoints+=1;
      }

      const key=route.registration_number || route.association_name;
      byAssociation[key] ||= {
        association:route.association_name,
        registrationNumber:route.registration_number,
        routes:0,
        endpoints:0,
        EXACT:0,
        ALIAS:0,
        HIGH_CONFIDENCE_CANDIDATE:0,
        AMBIGUOUS:0,
        UNRESOLVED:0
      };
      byAssociation[key].endpoints+=1;
      byAssociation[key][result.classification]+=1;

      if(result.classification==='HIGH_CONFIDENCE_CANDIDATE' && sampleCandidates.length<25){
        sampleCandidates.push({
          routeId:route.id,
          association:route.association_name,
          side,
          label,
          topCandidate:result.matches[0]?.canonical_name || null,
          topScore:result.topScore == null ? null : Number(result.topScore.toFixed(4)),
          scoreMargin:result.margin == null ? null : Number(result.margin.toFixed(4))
        });
      }
      if(result.classification==='UNRESOLVED' && unresolvedSamples.length<25){
        unresolvedSamples.push({routeId:route.id,association:route.association_name,side,label});
      }
      if(result.classification==='AMBIGUOUS' && ambiguousSamples.length<25){
        ambiguousSamples.push({
          routeId:route.id,
          association:route.association_name,
          side,
          label,
          reason:result.reason || null,
          candidates:result.matches.slice(0,3).map(m=>({name:m.canonical_name,score:m.score ?? null}))
        });
      }

      routeResults.push(result.classification);
    }

    const key=route.registration_number || route.association_name;
    byAssociation[key].routes+=1;

    if(routeResults.every(v=>v==='EXACT')) summary.exactBothEndpointsRoutes+=1;
    if(routeResults.every(v=>v==='EXACT' || v==='ALIAS')) summary.deterministicBothEndpointsRoutes+=1;
  }

  await client.query('ROLLBACK');

  console.log(JSON.stringify({
    event:'tn5_g_production_read_only_dry_run',
    mode:'read_only',
    databaseWrites:false,
    thresholds:{candidateThreshold,candidateMargin},
    database:counts.rows[0],
    summary,
    byAssociation:Object.values(byAssociation),
    sampleCandidates,
    ambiguousSamples,
    unresolvedSamples
  }));
}catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  console.error(JSON.stringify({event:'tn5_g_dry_run_failed',error:String(error?.message || error)}));
  process.exitCode=1;
}finally{
  client.release();
  await pool.end();
}
