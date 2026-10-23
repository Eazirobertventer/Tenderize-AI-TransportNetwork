function normalizeRankIdentity(value=''){
  return String(value)
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function compact(value=''){
  return normalizeRankIdentity(value).replace(/\s+/g,'');
}

function extractRankCodes(text=''){
  const upper=String(text).normalize('NFKC').toUpperCase();
  const matches=upper.match(/\b[A-Z]{2,5}\s*0?\d{3,6}\b/g)||[];
  return [...new Set(matches.map(code=>code.replace(/\s+/g,'')))];
}

function uniqueById(rows=[]){
  const seen=new Set();
  return rows.filter(row=>{
    if(seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

function informativeName(name=''){
  const n=normalizeRankIdentity(name);
  if(!n || n.length<6) return false;
  const stripped=n.replace(/\b(TAXI|RANK|TERMINAL|STATION)\b/g,'').replace(/\s+/g,' ').trim();
  return stripped.length>=4;
}

export async function recoverRankTargets(pool,{mentions=[],province='KwaZulu-Natal',limit=250}={}){
  if(!pool) return null;
  const rows=(mentions||[]).slice(0,Math.min(Math.max(Number(limit)||250,1),500));
  const ranks=(await pool.query(
    `SELECT id::text,canonical_name,aliases,province,municipality,town,verification_status::text
       FROM taxi_rank
       WHERE ($1::text IS NULL OR province=$1)
         AND coalesce(to_jsonb(taxi_rank)->>'merged_into_rank_id','')=''
       ORDER BY canonical_name,id`,
    [province||null]
  )).rows;

  const codeEvidence=(await pool.query(
    `SELECT rac.taxi_rank_id::text AS id,rac.source_rank_external_id AS code,
            r.canonical_name,r.province,r.municipality,r.town
       FROM rank_association_candidate rac
       JOIN taxi_rank r ON r.id=rac.taxi_rank_id
       WHERE rac.source_rank_external_id IS NOT NULL
         AND ($1::text IS NULL OR r.province=$1)
       UNION ALL
       SELECT sr.entity_id::text AS id,sr.external_record_id AS code,
              r.canonical_name,r.province,r.municipality,r.town
       FROM source_record sr
       JOIN taxi_rank r ON r.id=sr.entity_id
       WHERE sr.entity_type='taxi_rank'
         AND sr.external_record_id IS NOT NULL
         AND ($1::text IS NULL OR r.province=$1)`,
    [province||null]
  )).rows;

  const codeIndex=new Map();
  for(const row of codeEvidence){
    const key=compact(row.code);
    if(!key) continue;
    if(!codeIndex.has(key)) codeIndex.set(key,[]);
    codeIndex.get(key).push(row);
  }

  const output=[];
  for(const item of rows){
    const mention=String(item.mention||'').trim();
    const normalizedMention=normalizeRankIdentity(mention);
    const codes=extractRankCodes(mention);

    const codeMatches=[];
    for(const code of codes){
      for(const row of codeIndex.get(compact(code))||[]) codeMatches.push(row);
    }
    const uniqueCodeMatches=uniqueById(codeMatches);

    let recoveryBucket='no_deterministic_rank_match';
    let recommendedAction='collect_rank_target_evidence';
    let recoveredRank=null;
    let nameMatches=[];

    if(uniqueCodeMatches.length===1){
      recoveryBucket='rank_source_code_match';
      recommendedAction='reclassify_against_recovered_rank';
      recoveredRank=uniqueCodeMatches[0];
    }else if(uniqueCodeMatches.length>1){
      recoveryBucket='ambiguous_rank_source_code';
      recommendedAction='manual_rank_identity_review';
    }else{
      const matched=[];
      for(const rank of ranks){
        for(const value of [rank.canonical_name,...(rank.aliases||[])].filter(Boolean)){
          if(!informativeName(value)) continue;
          const needle=normalizeRankIdentity(value);
          if(needle && normalizedMention.includes(needle)){
            matched.push(rank);
            break;
          }
        }
      }
      nameMatches=uniqueById(matched);
      if(nameMatches.length===1){
        recoveryBucket='rank_exact_name_or_alias_phrase';
        recommendedAction='reclassify_against_recovered_rank';
        recoveredRank=nameMatches[0];
      }else if(nameMatches.length>1){
        recoveryBucket='ambiguous_rank_name_or_alias_phrase';
        recommendedAction='manual_rank_identity_review';
      }
    }

    output.push({
      ...item,
      normalizedMention,
      extractedRankCodes:codes,
      recoveryBucket,
      recoverable:Boolean(recoveredRank),
      recommendedAction,
      recoveredRank,
      matches:{
        sourceCode:uniqueCodeMatches,
        exactNameOrAliasPhrase:nameMatches
      },
      fuzzyMatching:false,
      automaticAliasCreation:false,
      automaticCanonicalMutation:false
    });
  }

  const buckets={};
  for(const item of output) buckets[item.recoveryBucket]=(buckets[item.recoveryBucket]||0)+1;

  return {
    mode:'tn7_national_19_rank_target_recovery',
    province,
    evidenceMentions:output.length,
    buckets,
    policy:{
      sourceCodeExact:true,
      exactCanonicalOrAliasPhrase:true,
      fuzzyMatching:false,
      geographicProximityMatching:false,
      automaticAliasCreation:false,
      automaticCanonicalMutation:false
    },
    items:output
  };
}

export { normalizeRankIdentity,extractRankCodes };
