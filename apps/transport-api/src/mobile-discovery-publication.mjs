import { assertTransportDiscoveryDocument } from './mobile-discovery-contract.mjs';
import { canonicalCoordinate, localityLabel, publishedRouteCode, publishedRouteName, rankDisplayName } from './mobile-discovery-policy.mjs';

const ELIGIBLE="('official','verified','documented','community_verified')";

const publicationSql=`
SELECT
  tr.id::text AS route_id,
  tr.national_route_code,
  tr.board_route_code,
  tr.source_route_code,
  tr.route_name,
  tr.updated_at AS route_updated_at,
  o.id::text AS origin_rank_id,
  o.canonical_name AS origin_canonical_name,
  o.aliases AS origin_aliases,
  o.town AS origin_town,
  o.municipality AS origin_municipality,
  CASE WHEN o.location IS NULL THEN NULL ELSE ST_Y(o.location) END AS origin_lat,
  CASE WHEN o.location IS NULL THEN NULL ELSE ST_X(o.location) END AS origin_lng,
  o.updated_at AS origin_updated_at,
  d.id::text AS destination_rank_id,
  d.canonical_name AS destination_canonical_name,
  d.aliases AS destination_aliases,
  d.town AS destination_town,
  d.municipality AS destination_municipality,
  CASE WHEN d.location IS NULL THEN NULL ELSE ST_Y(d.location) END AS destination_lat,
  CASE WHEN d.location IS NULL THEN NULL ELSE ST_X(d.location) END AS destination_lng,
  d.updated_at AS destination_updated_at,
  a.id::text AS association_id,
  a.canonical_name AS association_name,
  a.updated_at AS association_updated_at
FROM taxi_route tr
JOIN taxi_rank o ON o.id=tr.origin_rank_id
JOIN taxi_rank d ON d.id=tr.destination_rank_id
JOIN taxi_association a ON a.id=tr.association_id
JOIN taxi_rank_association ora
  ON ora.taxi_rank_id=tr.origin_rank_id AND ora.association_id=tr.association_id
JOIN taxi_rank_association dra
  ON dra.taxi_rank_id=tr.destination_rank_id AND dra.association_id=tr.association_id
JOIN route_candidate_promotion rcp ON rcp.route_id=tr.id
JOIN operator_decision_proposal odp ON odp.id=rcp.promoted_by_proposal_id
WHERE tr.id IS NOT NULL
  AND tr.association_id IS NOT NULL
  AND tr.origin_rank_id IS NOT NULL
  AND tr.destination_rank_id IS NOT NULL
  AND tr.origin_rank_id<>tr.destination_rank_id
  AND tr.verification_status IN ${ELIGIBLE}
  AND o.verification_status IN ${ELIGIBLE}
  AND d.verification_status IN ${ELIGIBLE}
  AND a.verification_status IN ${ELIGIBLE}
  AND ora.verification_status IN ${ELIGIBLE}
  AND dra.verification_status IN ${ELIGIBLE}
  AND o.merged_into_rank_id IS NULL
  AND d.merged_into_rank_id IS NULL
  AND a.merged_into_association_id IS NULL
  AND odp.status='approved'
  AND odp.action='taxi_route.promote'
  AND odp.approved_audit_event_id IS NOT NULL
  AND rcp.promoted_audit_event_id IS NOT NULL
  AND trim(coalesce(nullif(o.aliases[1],''),o.canonical_name))<>''
  AND trim(coalesce(nullif(d.aliases[1],''),d.canonical_name))<>''
  AND trim(a.canonical_name)<>''
  AND (o.location IS NULL OR (ST_Y(o.location) BETWEEN -90 AND 90 AND ST_X(o.location) BETWEEN -180 AND 180))
  AND (d.location IS NULL OR (ST_Y(d.location) BETWEEN -90 AND 90 AND ST_X(d.location) BETWEEN -180 AND 180))
ORDER BY tr.id::text`;

function asIso(value){
  if(value==null) return null;
  const date=value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function latestIso(values){
  let latest=null;
  for(const value of values){
    const iso=asIso(value);
    if(!iso) continue;
    if(latest===null || iso>latest) latest=iso;
  }
  return latest;
}

function withoutUndefined(value){
  return Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined));
}

function rankRef(row,prefix){
  const coordinate=canonicalCoordinate(
    row[prefix+'_lat']==null ? null : Number(row[prefix+'_lat']),
    row[prefix+'_lng']==null ? null : Number(row[prefix+'_lng'])
  );
  if(coordinate===null) throw new Error('publication_coordinate_invalid');
  const rankRow={
    aliases:row[prefix+'_aliases'] || [],
    canonicalName:row[prefix+'_canonical_name'],
    town:row[prefix+'_town'],
    municipality:row[prefix+'_municipality']
  };
  return withoutUndefined({
    rankId:row[prefix+'_rank_id'],
    name:rankDisplayName(rankRow),
    localityLabel:localityLabel(rankRow) || undefined,
    coordinate,
    publication:'published'
  });
}

export async function loadMobileDiscoveryPublication(pool,{now=()=>new Date()}={}){
  if(!pool) throw new Error('publication_database_unavailable');
  const result=await pool.query(publicationSql);
  const generatedAt=now().toISOString();
  const sourceValues=[];
  const routes=result.rows.map(row=>{
    sourceValues.push(row.route_updated_at,row.origin_updated_at,row.destination_updated_at,row.association_updated_at);
    const code=publishedRouteCode({
      nationalRouteCode:row.national_route_code,
      boardRouteCode:row.board_route_code,
      sourceRouteCode:row.source_route_code
    });
    const name=publishedRouteName({routeName:row.route_name});
    return withoutUndefined({
      routeId:row.route_id,
      originRank:rankRef(row,'origin'),
      destinationRank:rankRef(row,'destination'),
      associations:[{associationId:row.association_id,displayName:String(row.association_name).trim()}],
      routeCode:code || undefined,
      routeName:name || undefined,
      publication:'published'
    });
  });

  return assertTransportDiscoveryDocument({
    kind:'fairpay-transport-discovery',
    provenance:'canonical-fairpay-transport',
    freshness:'live',
    timestamps:{
      publishedAt:generatedAt,
      sourceDataThrough:latestIso(sourceValues),
      lastSuccessfulSyncAt:generatedAt
    },
    routes
  });
}
