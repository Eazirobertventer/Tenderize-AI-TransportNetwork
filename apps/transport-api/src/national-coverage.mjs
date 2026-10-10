const PROVINCES=[
  'Gauteng',
  'KwaZulu-Natal',
  'Western Cape',
  'Eastern Cape',
  'Free State',
  'Limpopo',
  'Mpumalanga',
  'North West',
  'Northern Cape'
];

function num(v){return Number(v||0);}

function priorityScore(row){
  // Operational backlog priority only. Never an evidence/canonical-truth score.
  const locationGap=num(row.location_pending_ranks);
  const associationGap=num(row.ranks_without_association);
  const routeEndpointGap=num(row.routes_with_unresolved_endpoints);
  const unassignedRouteGap=num(row.route_candidates_without_association)+num(row.canonical_routes_without_association);
  const issueGap=num(row.active_issues);
  const evidenceOpportunity=num(row.official_source_records)+num(row.documented_source_records);

  const gapWeight=
    locationGap*3+
    associationGap*4+
    routeEndpointGap*2+
    unassignedRouteGap*3+
    issueGap*2;

  // Evidence availability is a bounded multiplier: prioritise areas where
  // authoritative/documentary evidence may let operators close known gaps.
  const evidenceFactor=Math.min(1.35,1+(Math.log10(evidenceOpportunity+1)*0.08));
  return Math.round(gapWeight*evidenceFactor);
}

function classifyPriority(score){
  if(score>=1000) return 'critical';
  if(score>=400) return 'high';
  if(score>=120) return 'medium';
  return score>0?'low':'complete';
}

function completeness(row){
  const ranks=num(row.ranks);
  if(!ranks) return null;
  const mapped=num(row.mapped_ranks);
  const associated=ranks-num(row.ranks_without_association);
  const coordinateRate=mapped/ranks;
  const associationRate=Math.max(0,associated)/ranks;
  return Math.round(((coordinateRate*0.5)+(associationRate*0.5))*1000)/10;
}

function normalizeRow(row){
  const score=priorityScore(row);
  return {
    ...row,
    ranks:num(row.ranks),
    mapped_ranks:num(row.mapped_ranks),
    location_pending_ranks:num(row.location_pending_ranks),
    associations:num(row.associations),
    routes:num(row.routes),
    ranks_without_association:num(row.ranks_without_association),
    active_issues:num(row.active_issues),
    rank_association_candidates:num(row.rank_association_candidates),
    route_candidates_without_association:num(row.route_candidates_without_association),
    canonical_routes_without_association:num(row.canonical_routes_without_association),
    routes_with_unresolved_endpoints:num(row.routes_with_unresolved_endpoints),
    official_source_records:num(row.official_source_records),
    documented_source_records:num(row.documented_source_records),
    priorityScore:score,
    priorityBand:classifyPriority(score),
    completenessPercent:completeness(row),
    priorityBasis:'coverage_gap_x_evidence_opportunity'
  };
}

export async function loadNationalCoverageModel(pool,{province=null}={}){
  if(!pool) return null;

  const provinceRows=await pool.query(
    `WITH province_names AS (
       SELECT unnest($1::text[]) AS province
     ),
     ranks AS (
       SELECT
         coalesce(province,'Unknown') AS province,
         count(*) FILTER (WHERE coalesce(to_jsonb(taxi_rank)->>'merged_into_rank_id','')='')::int AS ranks,
         count(*) FILTER (WHERE location IS NOT NULL AND coalesce(to_jsonb(taxi_rank)->>'merged_into_rank_id','')='')::int AS mapped_ranks,
         count(*) FILTER (WHERE location IS NULL AND coalesce(to_jsonb(taxi_rank)->>'merged_into_rank_id','')='')::int AS location_pending_ranks,
         count(*) FILTER (
           WHERE coalesce(to_jsonb(taxi_rank)->>'merged_into_rank_id','')=''
             AND NOT EXISTS (
               SELECT 1 FROM taxi_rank_association ra WHERE ra.taxi_rank_id=taxi_rank.id
             )
         )::int AS ranks_without_association
       FROM taxi_rank
       GROUP BY coalesce(province,'Unknown')
     ),
     associations AS (
       SELECT coalesce(province,'Unknown') AS province,count(*)::int AS associations
       FROM taxi_association a
       WHERE coalesce(to_jsonb(a)->>'merged_into_association_id','')=''
       GROUP BY coalesce(province,'Unknown')
     ),
     routes AS (
       SELECT
         coalesce(a.province,o.province,d.province,'Unknown') AS province,
         count(*)::int AS routes,
         count(*) FILTER (WHERE tr.association_id IS NULL)::int AS canonical_routes_without_association,
         count(*) FILTER (WHERE tr.origin_rank_id IS NULL OR tr.destination_rank_id IS NULL)::int AS routes_with_unresolved_endpoints
       FROM taxi_route tr
       LEFT JOIN taxi_association a ON a.id=tr.association_id
       LEFT JOIN taxi_rank o ON o.id=tr.origin_rank_id
       LEFT JOIN taxi_rank d ON d.id=tr.destination_rank_id
       GROUP BY coalesce(a.province,o.province,d.province,'Unknown')
     ),
     issues AS (
       SELECT
         coalesce(r.province,a.province,'Unknown') AS province,
         count(*) FILTER (WHERE di.status IN ('open','reviewing','deferred'))::int AS active_issues
       FROM data_issue di
       LEFT JOIN taxi_rank r ON di.entity_type='taxi_rank' AND r.id=di.entity_id
       LEFT JOIN taxi_association a ON di.entity_type='taxi_association' AND a.id=di.entity_id
       GROUP BY coalesce(r.province,a.province,'Unknown')
     ),
     rank_candidates AS (
       SELECT coalesce(r.province,'Unknown') AS province,count(*)::int AS rank_association_candidates
       FROM rank_association_candidate rac
       LEFT JOIN taxi_rank r ON r.id=rac.taxi_rank_id
       GROUP BY coalesce(r.province,'Unknown')
     ),
     route_candidates AS (
       SELECT
         coalesce(o.province,d.province,'Unknown') AS province,
         count(*) FILTER (WHERE rc.association_id IS NULL)::int AS route_candidates_without_association
       FROM route_candidate rc
       LEFT JOIN taxi_rank o ON o.id=rc.origin_rank_id
       LEFT JOIN taxi_rank d ON d.id=rc.destination_rank_id
       GROUP BY coalesce(o.province,d.province,'Unknown')
     ),
     source_evidence AS (
       SELECT
         coalesce(r.province,a.province,'Unknown') AS province,
         count(*) FILTER (WHERE s.official=true OR s.source_class IN ('official_gis','provincial_transport'))::int AS official_source_records,
         count(*) FILTER (WHERE NOT s.official AND s.source_class IN ('nltis_olas','municipal_itp','santaco','nta','community','commercial_directory'))::int AS documented_source_records
       FROM source_record sr
       JOIN source_registry s ON s.id=sr.source_id
       LEFT JOIN taxi_rank r ON sr.entity_type='taxi_rank' AND r.id=sr.entity_id
       LEFT JOIN taxi_association a ON sr.entity_type='taxi_association' AND a.id=sr.entity_id
       GROUP BY coalesce(r.province,a.province,'Unknown')
     )
     SELECT
       pn.province,
       coalesce(r.ranks,0)::int AS ranks,
       coalesce(r.mapped_ranks,0)::int AS mapped_ranks,
       coalesce(r.location_pending_ranks,0)::int AS location_pending_ranks,
       coalesce(a.associations,0)::int AS associations,
       coalesce(rt.routes,0)::int AS routes,
       coalesce(r.ranks_without_association,0)::int AS ranks_without_association,
       coalesce(i.active_issues,0)::int AS active_issues,
       coalesce(rc.rank_association_candidates,0)::int AS rank_association_candidates,
       coalesce(rtc.route_candidates_without_association,0)::int AS route_candidates_without_association,
       coalesce(rt.canonical_routes_without_association,0)::int AS canonical_routes_without_association,
       coalesce(rt.routes_with_unresolved_endpoints,0)::int AS routes_with_unresolved_endpoints,
       coalesce(se.official_source_records,0)::int AS official_source_records,
       coalesce(se.documented_source_records,0)::int AS documented_source_records
     FROM province_names pn
     LEFT JOIN ranks r ON r.province=pn.province
     LEFT JOIN associations a ON a.province=pn.province
     LEFT JOIN routes rt ON rt.province=pn.province
     LEFT JOIN issues i ON i.province=pn.province
     LEFT JOIN rank_candidates rc ON rc.province=pn.province
     LEFT JOIN route_candidates rtc ON rtc.province=pn.province
     LEFT JOIN source_evidence se ON se.province=pn.province
     ORDER BY pn.province`,
    [PROVINCES]
  );

  const provinces=provinceRows.rows.map(normalizeRow)
    .sort((a,b)=>b.priorityScore-a.priorityScore || a.province.localeCompare(b.province));

  const nationalResult=await pool.query(
    `SELECT
       (SELECT count(*)::int FROM taxi_rank r WHERE coalesce(to_jsonb(r)->>'merged_into_rank_id','')='') AS ranks,
       (SELECT count(*)::int FROM taxi_rank r WHERE r.location IS NOT NULL AND coalesce(to_jsonb(r)->>'merged_into_rank_id','')='') AS mapped_ranks,
       (SELECT count(*)::int FROM taxi_rank r WHERE r.location IS NULL AND coalesce(to_jsonb(r)->>'merged_into_rank_id','')='') AS location_pending_ranks,
       (SELECT count(*)::int FROM taxi_association a WHERE coalesce(to_jsonb(a)->>'merged_into_association_id','')='') AS associations,
       (SELECT count(*)::int FROM taxi_route) AS routes,
       (SELECT count(*)::int
          FROM taxi_rank r
          WHERE coalesce(to_jsonb(r)->>'merged_into_rank_id','')=''
            AND NOT EXISTS (SELECT 1 FROM taxi_rank_association ra WHERE ra.taxi_rank_id=r.id)
       ) AS ranks_without_association,
       (SELECT count(*)::int FROM data_issue WHERE status IN ('open','reviewing','deferred')) AS active_issues,
       (SELECT count(*)::int FROM rank_association_candidate) AS rank_association_candidates,
       (SELECT count(*)::int FROM route_candidate WHERE association_id IS NULL) AS route_candidates_without_association,
       (SELECT count(*)::int FROM taxi_route WHERE association_id IS NULL) AS canonical_routes_without_association,
       (SELECT count(*)::int FROM taxi_route WHERE origin_rank_id IS NULL OR destination_rank_id IS NULL) AS routes_with_unresolved_endpoints,
       (SELECT count(*)::int
          FROM source_record sr
          JOIN source_registry s ON s.id=sr.source_id
          WHERE s.official=true OR s.source_class IN ('official_gis','provincial_transport')
       ) AS official_source_records,
       (SELECT count(*)::int
          FROM source_record sr
          JOIN source_registry s ON s.id=sr.source_id
          WHERE NOT s.official
            AND s.source_class IN ('nltis_olas','municipal_itp','santaco','nta','community','commercial_directory')
       ) AS documented_source_records`
  );

  let municipalities=[];
  if(province){
    const result=await pool.query(
      `WITH rank_base AS (
         SELECT
           coalesce(nullif(trim(town),''),nullif(trim(municipality),''),'Unknown') AS municipality,
           id,
           location
         FROM taxi_rank
         WHERE province=$1
           AND coalesce(to_jsonb(taxi_rank)->>'merged_into_rank_id','')=''
       ),
       assoc_counts AS (
         SELECT
           rb.municipality,
           count(DISTINCT ra.association_id)::int AS associations
         FROM rank_base rb
         LEFT JOIN taxi_rank_association ra ON ra.taxi_rank_id=rb.id
         GROUP BY rb.municipality
       ),
       route_counts AS (
         SELECT
           rb.municipality,
           count(DISTINCT tr.id)::int AS routes,
           count(DISTINCT tr.id) FILTER (WHERE tr.association_id IS NULL)::int AS canonical_routes_without_association,
           count(DISTINCT tr.id) FILTER (WHERE tr.origin_rank_id IS NULL OR tr.destination_rank_id IS NULL)::int AS routes_with_unresolved_endpoints
         FROM rank_base rb
         LEFT JOIN taxi_route tr ON tr.origin_rank_id=rb.id OR tr.destination_rank_id=rb.id
         GROUP BY rb.municipality
       ),
       issue_counts AS (
         SELECT
           coalesce(nullif(trim(r.town),''),nullif(trim(r.municipality),''),'Unknown') AS municipality,
           count(*) FILTER (WHERE di.status IN ('open','reviewing','deferred'))::int AS active_issues
         FROM data_issue di
         JOIN taxi_rank r ON di.entity_type='taxi_rank' AND r.id=di.entity_id
         WHERE r.province=$1
         GROUP BY coalesce(nullif(trim(r.town),''),nullif(trim(r.municipality),''),'Unknown')
       ),
       candidate_counts AS (
         SELECT
           coalesce(nullif(trim(r.town),''),nullif(trim(r.municipality),''),'Unknown') AS municipality,
           count(*)::int AS rank_association_candidates
         FROM rank_association_candidate rac
         JOIN taxi_rank r ON r.id=rac.taxi_rank_id
         WHERE r.province=$1
         GROUP BY coalesce(nullif(trim(r.town),''),nullif(trim(r.municipality),''),'Unknown')
       ),
       route_candidate_counts AS (
         SELECT
           coalesce(nullif(trim(o.town),''),nullif(trim(o.municipality),''),nullif(trim(d.town),''),nullif(trim(d.municipality),''),'Unknown') AS municipality,
           count(*) FILTER (WHERE rc.association_id IS NULL)::int AS route_candidates_without_association
         FROM route_candidate rc
         LEFT JOIN taxi_rank o ON o.id=rc.origin_rank_id
         LEFT JOIN taxi_rank d ON d.id=rc.destination_rank_id
         WHERE coalesce(o.province,d.province)=$1
         GROUP BY coalesce(nullif(trim(o.town),''),nullif(trim(o.municipality),''),nullif(trim(d.town),''),nullif(trim(d.municipality),''),'Unknown')
       )
       SELECT
         rb.municipality,
         count(*)::int AS ranks,
         count(*) FILTER (WHERE rb.location IS NOT NULL)::int AS mapped_ranks,
         count(*) FILTER (WHERE rb.location IS NULL)::int AS location_pending_ranks,
         coalesce(ac.associations,0)::int AS associations,
         coalesce(rt.routes,0)::int AS routes,
         count(*) FILTER (
           WHERE NOT EXISTS (
             SELECT 1 FROM taxi_rank_association ra WHERE ra.taxi_rank_id=rb.id
           )
         )::int AS ranks_without_association,
         coalesce(ic.active_issues,0)::int AS active_issues,
         coalesce(cc.rank_association_candidates,0)::int AS rank_association_candidates,
         coalesce(rcc.route_candidates_without_association,0)::int AS route_candidates_without_association,
         coalesce(rt.canonical_routes_without_association,0)::int AS canonical_routes_without_association,
         coalesce(rt.routes_with_unresolved_endpoints,0)::int AS routes_with_unresolved_endpoints,
         0::int AS official_source_records,
         0::int AS documented_source_records
       FROM rank_base rb
       LEFT JOIN assoc_counts ac ON ac.municipality=rb.municipality
       LEFT JOIN route_counts rt ON rt.municipality=rb.municipality
       LEFT JOIN issue_counts ic ON ic.municipality=rb.municipality
       LEFT JOIN candidate_counts cc ON cc.municipality=rb.municipality
       LEFT JOIN route_candidate_counts rcc ON rcc.municipality=rb.municipality
       GROUP BY rb.municipality,ac.associations,rt.routes,rt.canonical_routes_without_association,
                rt.routes_with_unresolved_endpoints,ic.active_issues,cc.rank_association_candidates,
                rcc.route_candidates_without_association
       ORDER BY rb.municipality`,
      [province]
    );

    municipalities=result.rows.map(row=>normalizeRow({...row,province}))
      .sort((a,b)=>b.priorityScore-a.priorityScore || a.municipality.localeCompare(b.municipality));
  }

  const national=normalizeRow({...nationalResult.rows[0],province:'National'});

  return {
    mode:'coverage_gap_model',
    canonicalMutationEnabled:false,
    priorityDisclaimer:'Priority ranks operational backlog opportunity only; it is not canonical confidence or evidence truth.',
    national,
    provinces,
    municipalities,
    unscoped:{
      rankGap:Number(national.ranks)-provinces.reduce((sum,row)=>sum+Number(row.ranks||0),0),
      routeGap:Number(national.routes)-provinces.reduce((sum,row)=>sum+Number(row.routes||0),0),
      routeCandidateAssociationGap:Number(national.route_candidates_without_association)-provinces.reduce((sum,row)=>sum+Number(row.route_candidates_without_association||0),0)
    }
  };
}

export async function loadCoverageGapFeatures(pool,{province=null,municipality=null}={}){
  if(!pool) return {type:'FeatureCollection',features:[]};
  const params=[];
  const where=[
    "r.location IS NOT NULL",
    "coalesce(to_jsonb(r)->>'merged_into_rank_id','')=''"
  ];
  if(province){params.push(province);where.push('r.province=$'+params.length);}
  if(municipality){
    params.push(municipality);
    where.push("coalesce(nullif(trim(r.town),''),nullif(trim(r.municipality),''),'Unknown')=$"+params.length);
  }

  const result=await pool.query(
    `SELECT
       r.id::text,
       r.canonical_name,
       r.province,
       coalesce(nullif(trim(r.town),''),nullif(trim(r.municipality),''),'Unknown') AS municipality,
       ST_X(r.location) AS lng,
       ST_Y(r.location) AS lat,
       NOT EXISTS (SELECT 1 FROM taxi_rank_association ra WHERE ra.taxi_rank_id=r.id) AS missing_association,
       EXISTS (
         SELECT 1 FROM data_issue di
         WHERE di.entity_type='taxi_rank'
           AND di.entity_id=r.id
           AND di.status IN ('open','reviewing','deferred')
       ) AS has_active_issue,
       EXISTS (
         SELECT 1 FROM rank_association_candidate rac
         WHERE rac.taxi_rank_id=r.id
       ) AS has_association_candidate
     FROM taxi_rank r
     WHERE ${where.join(' AND ')}
       AND (
         NOT EXISTS (SELECT 1 FROM taxi_rank_association ra WHERE ra.taxi_rank_id=r.id)
         OR EXISTS (
           SELECT 1 FROM data_issue di
           WHERE di.entity_type='taxi_rank' AND di.entity_id=r.id
             AND di.status IN ('open','reviewing','deferred')
         )
         OR EXISTS (
           SELECT 1 FROM rank_association_candidate rac WHERE rac.taxi_rank_id=r.id
         )
       )
     ORDER BY r.canonical_name
     LIMIT 10000`,
    params
  );

  return {
    type:'FeatureCollection',
    features:result.rows.map(row=>{
      const classes=[];
      if(row.missing_association) classes.push('missing_association');
      if(row.has_active_issue) classes.push('active_issue');
      if(row.has_association_candidate) classes.push('association_candidate');
      return {
        type:'Feature',
        id:row.id,
        geometry:{type:'Point',coordinates:[Number(row.lng),Number(row.lat)]},
        properties:{
          id:row.id,
          name:row.canonical_name,
          province:row.province,
          municipality:row.municipality,
          gapClasses:classes,
          primaryGap:classes[0]||'coverage_gap'
        }
      };
    })
  };
}
