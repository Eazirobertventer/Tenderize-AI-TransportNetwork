import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { authenticateOperatorRequest, operatorAuthCapabilities } from './operator-auth.mjs';
import { appendOperatorAuditEvent } from './operator-audit.mjs';
import { loadOperatorWorkbench, operatorWorkbenchSchemaAvailable } from './operator-workbench.mjs';
import { loadNationalCoverageModel, loadCoverageGapFeatures } from './national-coverage.mjs';
import { loadKznCoverageExecution } from './kzn-coverage.mjs';
import {
  createDataIssueDeferProposal,
  createAliasProposal,
  createRankAssociationAssignmentProposal,
  createRoutePromotionProposal,
  createTaxiRankMergeProposal,
  createTaxiAssociationMergeProposal,
  approveDecisionProposal,
  rejectDecisionProposal,
  withdrawDecisionProposal,
  getDecisionProposal
} from './operator-proposals.mjs';

const { Pool } = pg;
const port = Number(process.env.PORT || 8080);
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString:process.env.DATABASE_URL,
  max:5,
  ssl:false
}) : null;

function send(res,status,payload){
  res.writeHead(status,{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store',
    'access-control-allow-origin':process.env.CORS_ORIGIN || '*'
  });
  res.end(JSON.stringify(payload));
}

async function postgisRanks(url){
  const params=[];
  const where=['r.location IS NOT NULL',"coalesce(to_jsonb(r)->>'merged_into_rank_id','')=''"];
  const province=url.searchParams.get('province');
  const city=url.searchParams.get('city');
  const q=url.searchParams.get('q');

  if (province) {
    params.push(province);
    where.push(`r.province = $${params.length}`);
  }

  if (city) {
    params.push(city);
    const i=params.length;
    where.push(`coalesce(nullif(trim(r.town),''),nullif(trim(r.municipality),'')) = $${i}`);
  }

  if (q) {
    params.push('%' + q + '%');
    const i=params.length;
    where.push(`(r.canonical_name ILIKE $${i} OR EXISTS (SELECT 1 FROM unnest(coalesce(r.aliases,ARRAY[]::text[])) a WHERE a ILIKE $${i}) OR coalesce(r.town,'') ILIKE $${i} OR coalesce(r.municipality,'') ILIKE $${i})`);
  }

  const result=await pool.query(
    `SELECT
       r.id::text,
       r.canonical_name,
       r.aliases,
       coalesce(nullif(r.aliases[1],''),r.canonical_name) AS display_name,
       r.town,
       r.municipality,
       r.province,
       r.verification_status::text,
       ST_X(r.location) AS lng,
       ST_Y(r.location) AS lat,
       s.source_name
     FROM taxi_rank r
     LEFT JOIN LATERAL (
       SELECT source_id
       FROM source_record
       WHERE entity_type='taxi_rank' AND entity_id=r.id
       ORDER BY source_retrieved_at DESC
       LIMIT 1
     ) sr ON true
     LEFT JOIN source_registry s ON s.id=sr.source_id
     WHERE ${where.join(' AND ')}
     ORDER BY r.canonical_name
     LIMIT 10000`,
    params
  );

  return {
    type:'FeatureCollection',
    features:result.rows.map(row => ({
      type:'Feature',
      id:row.id,
      geometry:{type:'Point',coordinates:[Number(row.lng),Number(row.lat)]},
      properties:{
        id:row.id,
        name:row.display_name,
        displayName:row.display_name,
        sourceCode:row.canonical_name,
        aliases:row.aliases || [],
        town:row.town,
        municipality:row.municipality,
        province:row.province,
        verificationStatus:row.verification_status,
        source:row.source_name || 'PostGIS canonical'
      }
    }))
  };
}

async function postgisRankFilters(url){
  const province=url.searchParams.get('province');

  const provinces=await pool.query(
    `SELECT DISTINCT province
     FROM taxi_rank
     WHERE location IS NOT NULL
       AND coalesce(to_jsonb(taxi_rank)->>'merged_into_rank_id','')=''
       AND province IS NOT NULL
       AND trim(province)<>''
     ORDER BY province`
  );

  const params=[];
  const where=[
    'location IS NOT NULL',
    "coalesce(to_jsonb(taxi_rank)->>'merged_into_rank_id','')=''",
    "coalesce(nullif(trim(town),''),nullif(trim(municipality),'')) IS NOT NULL"
  ];

  if(province){
    params.push(province);
    where.push('province = ' + String.fromCharCode(36) + params.length);
  }

  const cities=await pool.query(
    `SELECT DISTINCT coalesce(nullif(trim(town),''),nullif(trim(municipality),'')) AS city
     FROM taxi_rank
     WHERE ${where.join(' AND ')}
     ORDER BY city`,
    params
  );

  return {
    provinces:provinces.rows.map(row=>row.province),
    cities:cities.rows.map(row=>row.city)
  };
}

async function postgisCoverage(url){
  const province=url.searchParams.get('province');

  const national=await pool.query(
    `SELECT
       (SELECT count(*)::int FROM taxi_rank r WHERE coalesce(to_jsonb(r)->>'merged_into_rank_id','')='') AS ranks,
       (SELECT count(*)::int FROM taxi_rank r WHERE r.location IS NOT NULL AND coalesce(to_jsonb(r)->>'merged_into_rank_id','')='') AS mapped_ranks,
       (SELECT count(*)::int FROM taxi_rank r WHERE r.location IS NULL AND coalesce(to_jsonb(r)->>'merged_into_rank_id','')='') AS location_pending_ranks,
       (SELECT count(*)::int FROM taxi_association a WHERE coalesce(to_jsonb(a)->>'merged_into_association_id','')='') AS associations,
       (SELECT count(*)::int FROM taxi_route) AS routes,
       (SELECT count(*)::int FROM source_registry) AS sources`
  );

  const provinces=await pool.query(
    `WITH names AS (
       SELECT province FROM taxi_rank r WHERE coalesce(to_jsonb(r)->>'merged_into_rank_id','')='' AND province IS NOT NULL AND trim(province)<>''
       UNION
       SELECT province FROM taxi_association a WHERE coalesce(to_jsonb(a)->>'merged_into_association_id','')='' AND province IS NOT NULL AND trim(province)<>''
     )
     SELECT
       names.province,
       (SELECT count(*)::int FROM taxi_rank r WHERE r.province=names.province AND coalesce(to_jsonb(r)->>'merged_into_rank_id','')='') AS ranks,
       (SELECT count(*)::int FROM taxi_rank r WHERE r.province=names.province AND r.location IS NOT NULL AND coalesce(to_jsonb(r)->>'merged_into_rank_id','')='') AS mapped_ranks,
       (SELECT count(*)::int FROM taxi_rank r WHERE r.province=names.province AND r.location IS NULL AND coalesce(to_jsonb(r)->>'merged_into_rank_id','')='') AS location_pending_ranks,
       (SELECT count(*)::int FROM taxi_association a WHERE a.province=names.province) AS associations,
       (SELECT count(*)::int
          FROM taxi_route tr
          JOIN taxi_association a ON a.id=tr.association_id
          WHERE a.province=names.province) AS routes
     FROM names
     ORDER BY names.province`
  );

  let areas=[];
  if(province){
    const result=await pool.query(
      `WITH rank_area AS (
         SELECT
           coalesce(nullif(trim(town),''),nullif(trim(municipality),''),'Unknown') AS area,
           id,
           location
         FROM taxi_rank
         WHERE province=$1
           AND coalesce(to_jsonb(taxi_rank)->>'merged_into_rank_id','')=''
       )
       SELECT
         ra.area,
         count(DISTINCT ra.id)::int AS ranks,
         count(DISTINCT ra.id) FILTER (WHERE ra.location IS NOT NULL)::int AS mapped_ranks,
         count(DISTINCT raa.association_id)::int AS associations,
         count(DISTINCT tr.id)::int AS routes
       FROM rank_area ra
       LEFT JOIN taxi_rank_association raa ON raa.taxi_rank_id=ra.id
       LEFT JOIN taxi_route tr
         ON tr.origin_rank_id=ra.id OR tr.destination_rank_id=ra.id
       GROUP BY ra.area
       ORDER BY (ra.area='Unknown'),ranks DESC,ra.area`,
      [province]
    );
    areas=result.rows;
  }

  return {national:national.rows[0],provinces:provinces.rows,areas};
}

async function postgisAssociationMap(url){
  const params=[];
  const where=["coalesce(to_jsonb(a)->>'merged_into_association_id','')=''"];
  const province=url.searchParams.get('province');
  const q=url.searchParams.get('q');
  const area=url.searchParams.get('area');

  if(province){
    params.push(province);
    where.push('a.province=' + String.fromCharCode(36) + params.length);
  }

  if(q){
    params.push('%'+q+'%');
    const p=String.fromCharCode(36)+params.length;
    where.push("(a.canonical_name ILIKE "+p+" OR coalesce(a.registration_number,'') ILIKE "+p+" OR coalesce(a.acronym,'') ILIKE "+p+")");
  }

  if(area){
    params.push(area);
    const p=String.fromCharCode(36)+params.length;
    where.push(
      "(coalesce(nullif(trim(a.municipality),''),'')="+p+
      " OR EXISTS ("+
      "SELECT 1 FROM taxi_rank_association area_ra "+
      "JOIN taxi_rank area_r ON area_r.id=area_ra.taxi_rank_id "+
      "WHERE area_ra.association_id=a.id "+
      "AND coalesce(nullif(trim(area_r.town),''),nullif(trim(area_r.municipality),''),'Unknown')="+p+
      "))"
    );
  }

  const result=await pool.query(
    `SELECT
       a.id::text,
       a.canonical_name,
       a.acronym,
       a.registration_number,
       a.province,
       a.municipality,
       a.address,
       a.verification_status::text,
       count(DISTINCT ra.taxi_rank_id)::int AS rank_count,
       count(DISTINCT tr.id)::int AS route_count,
       CASE
         WHEN a.location IS NOT NULL THEN 'authoritative_association_location'
         WHEN count(DISTINCT r.id) FILTER (WHERE r.location IS NOT NULL)>0 THEN 'linked_rank_centroid'
         ELSE 'unmapped'
       END AS location_basis,
       CASE
         WHEN a.location IS NOT NULL THEN ST_X(a.location)
         ELSE ST_X(ST_Centroid(ST_Collect(r.location) FILTER (WHERE r.location IS NOT NULL)))
       END AS lng,
       CASE
         WHEN a.location IS NOT NULL THEN ST_Y(a.location)
         ELSE ST_Y(ST_Centroid(ST_Collect(r.location) FILTER (WHERE r.location IS NOT NULL)))
       END AS lat
     FROM taxi_association a
     LEFT JOIN taxi_rank_association ra ON ra.association_id=a.id
     LEFT JOIN taxi_rank r ON r.id=ra.taxi_rank_id
     LEFT JOIN taxi_route tr ON tr.association_id=a.id
     WHERE ${where.join(' AND ')}
     GROUP BY a.id
     ORDER BY a.canonical_name`,
    params
  );

  return {
    type:'FeatureCollection',
    features:result.rows
      .filter(row=>row.lng!=null && row.lat!=null)
      .map(row=>({
        type:'Feature',
        id:row.id,
        geometry:{type:'Point',coordinates:[Number(row.lng),Number(row.lat)]},
        properties:{
          id:row.id,
          name:row.canonical_name,
          acronym:row.acronym,
          registrationNumber:row.registration_number,
          province:row.province,
          municipality:row.municipality,
          address:row.address,
          verificationStatus:row.verification_status,
          rankCount:row.rank_count,
          routeCount:row.route_count,
          locationBasis:row.location_basis,
          derivedLocation:row.location_basis==='linked_rank_centroid'
        }
      }))
  };
}

async function postgisAssociationDetail(id){
  const associationResult=await pool.query(
    `SELECT
       a.id::text,
       a.canonical_name,
       a.acronym,
       a.registration_number,
       a.affiliation,
       a.province,
       a.district,
       a.municipality,
       a.address,
       a.verification_status::text,
       count(DISTINCT ra.taxi_rank_id)::int AS rank_count,
       count(DISTINCT tr.id)::int AS route_count,
       CASE
         WHEN a.location IS NOT NULL THEN 'authoritative_association_location'
         WHEN count(DISTINCT r.id) FILTER (WHERE r.location IS NOT NULL)>0 THEN 'linked_rank_centroid'
         ELSE 'unmapped'
       END AS location_basis,
       CASE
         WHEN a.location IS NOT NULL THEN ST_X(a.location)
         ELSE ST_X(ST_Centroid(ST_Collect(r.location) FILTER (WHERE r.location IS NOT NULL)))
       END AS lng,
       CASE
         WHEN a.location IS NOT NULL THEN ST_Y(a.location)
         ELSE ST_Y(ST_Centroid(ST_Collect(r.location) FILTER (WHERE r.location IS NOT NULL)))
       END AS lat
     FROM taxi_association a
     LEFT JOIN taxi_rank_association ra ON ra.association_id=a.id
     LEFT JOIN taxi_rank r ON r.id=ra.taxi_rank_id
     LEFT JOIN taxi_route tr ON tr.association_id=a.id
     WHERE a.id=$1::uuid
       AND coalesce(to_jsonb(a)->>'merged_into_association_id','')=''
     GROUP BY a.id`,
    [id]
  );

  const association=associationResult.rows[0];
  if(!association) return null;

  const ranksResult=await pool.query(
    `SELECT
       r.id::text,
       r.canonical_name,
       r.aliases,
       coalesce(nullif(r.aliases[1],''),r.canonical_name) AS display_name,
       r.town,
       r.municipality,
       r.province,
       r.verification_status::text,
       ra.verification_status::text AS relation_verification_status,
       ra.confidence,
       CASE WHEN r.location IS NULL THEN NULL ELSE ST_X(r.location) END AS lng,
       CASE WHEN r.location IS NULL THEN NULL ELSE ST_Y(r.location) END AS lat
     FROM taxi_rank_association ra
     JOIN taxi_rank r ON r.id=ra.taxi_rank_id
     WHERE ra.association_id=$1::uuid
     ORDER BY r.canonical_name`,
    [id]
  );

  const routesResult=await pool.query(
    `SELECT
       tr.id::text,
       tr.origin_label,
       tr.destination_label,
       tr.route_name,
       tr.route_type,
       tr.national_route_code,
       tr.board_route_code,
       tr.geometry_status,
       tr.verification_status::text,
       CASE WHEN tr.geometry IS NULL THEN NULL ELSE ST_AsGeoJSON(tr.geometry)::json END AS geometry
     FROM taxi_route tr
     WHERE tr.association_id=$1::uuid
     ORDER BY tr.origin_label,tr.destination_label,tr.id`,
    [id]
  );

  const sources=await pool.query(
    `SELECT
       s.source_key,
       s.source_name,
       s.authority,
       sr.external_record_id,
       sr.source_last_checked_at
     FROM source_record sr
     JOIN source_registry s ON s.id=sr.source_id
     WHERE sr.entity_type='taxi_association'
       AND sr.entity_id=$1::uuid
     ORDER BY sr.source_retrieved_at DESC`,
    [id]
  );

  const rankItems=ranksResult.rows.map(row=>({
    id:row.id,
    name:row.display_name,
    sourceCode:row.canonical_name,
    aliases:row.aliases || [],
    town:row.town,
    municipality:row.municipality,
    province:row.province,
    verificationStatus:row.verification_status,
    relationVerificationStatus:row.relation_verification_status,
    confidence:row.confidence==null?null:Number(row.confidence),
    lng:row.lng==null?null:Number(row.lng),
    lat:row.lat==null?null:Number(row.lat)
  }));

  const routeItems=routesResult.rows.map(row=>({
    id:row.id,
    origin:row.origin_label,
    destination:row.destination_label,
    name:row.route_name,
    routeType:row.route_type,
    nationalRouteCode:row.national_route_code,
    boardRouteCode:row.board_route_code,
    geometryStatus:row.geometry_status,
    verificationStatus:row.verification_status,
    geometry:row.geometry
  }));

  return {
    association:{
      id:association.id,
      name:association.canonical_name,
      acronym:association.acronym,
      registrationNumber:association.registration_number,
      affiliation:association.affiliation,
      province:association.province,
      district:association.district,
      municipality:association.municipality,
      address:association.address,
      verificationStatus:association.verification_status,
      rankCount:association.rank_count,
      routeCount:association.route_count,
      locationBasis:association.location_basis,
      lng:association.lng==null?null:Number(association.lng),
      lat:association.lat==null?null:Number(association.lat)
    },
    rankItems,
    ranks:{
      type:'FeatureCollection',
      features:rankItems
        .filter(row=>Number.isFinite(row.lng) && Number.isFinite(row.lat))
        .map(row=>({
          type:'Feature',
          id:row.id,
          geometry:{type:'Point',coordinates:[row.lng,row.lat]},
          properties:row
        }))
    },
    unmappedRankCount:rankItems.filter(row=>!Number.isFinite(row.lng) || !Number.isFinite(row.lat)).length,
    routeItems,
    routes:{
      type:'FeatureCollection',
      features:routeItems
        .filter(row=>row.geometry)
        .map(row=>({
          type:'Feature',
          id:row.id,
          geometry:row.geometry,
          properties:{
            id:row.id,
            origin:row.origin,
            destination:row.destination,
            name:row.name,
            routeType:row.routeType,
            nationalRouteCode:row.nationalRouteCode,
            boardRouteCode:row.boardRouteCode,
            geometryStatus:row.geometryStatus,
            verificationStatus:row.verificationStatus
          }
        }))
    },
    sources:sources.rows
  };
}

async function postgisDataQualitySummary(){
  const result=await pool.query(
    `SELECT
       (SELECT count(*)::int FROM data_issue WHERE status IN ('open','reviewing','deferred')) AS open_issues,
       (SELECT count(*)::int FROM data_issue WHERE status='reviewing') AS reviewing_issues,
       (SELECT count(*)::int FROM data_issue WHERE severity IN ('error','blocking') AND status IN ('open','reviewing','deferred')) AS high_severity_issues,
       (SELECT count(*)::int FROM taxi_rank WHERE location IS NULL) AS ranks_missing_location,
       (SELECT count(*)::int
          FROM taxi_rank r
          WHERE NOT EXISTS (SELECT 1 FROM taxi_rank_association ra WHERE ra.taxi_rank_id=r.id)) AS ranks_without_association,
       (SELECT count(*)::int FROM rank_association_candidate) AS rank_association_candidates,
       (SELECT count(DISTINCT normalized_label)::int FROM rank_association_candidate) AS unresolved_association_labels,
       (SELECT count(*)::int FROM route_candidate WHERE association_id IS NULL) AS route_candidates_without_association,
       (SELECT count(*)::int FROM taxi_route WHERE association_id IS NULL) AS canonical_routes_without_association,
       (SELECT count(*)::int FROM taxi_route WHERE origin_rank_id IS NULL OR destination_rank_id IS NULL) AS routes_with_unresolved_endpoints`
  );
  return {mode:'aggregate_only',mutationEnabled:false,...result.rows[0]};
}

async function postgisNetworkInventory(){
  const counts=await pool.query(
    `SELECT
       (SELECT count(*)::int FROM taxi_rank r WHERE coalesce(to_jsonb(r)->>'merged_into_rank_id','')='') AS ranks,
       (SELECT count(*)::int FROM taxi_rank r WHERE r.location IS NOT NULL AND coalesce(to_jsonb(r)->>'merged_into_rank_id','')='') AS mapped_ranks,
       (SELECT count(*)::int FROM taxi_rank r WHERE r.location IS NULL AND coalesce(to_jsonb(r)->>'merged_into_rank_id','')='') AS location_pending_ranks,
       (SELECT count(*)::int FROM taxi_association) AS associations,
       (SELECT count(*)::int FROM taxi_route) AS routes,
       (SELECT count(*)::int FROM rank_association_candidate) AS rank_association_candidates,
       (SELECT count(DISTINCT normalized_label)::int FROM rank_association_candidate) AS unique_candidate_association_labels`
  );

  const sources=await pool.query(
    `SELECT
       s.source_key,
       s.source_name,
       s.authority,
       s.source_class,
       count(sr.*) FILTER (WHERE sr.entity_type='taxi_rank')::int AS rank_records,
       count(sr.*) FILTER (WHERE sr.entity_type='taxi_route')::int AS route_records,
       count(sr.*) FILTER (WHERE sr.entity_type='taxi_association')::int AS association_records
     FROM source_registry s
     LEFT JOIN source_record sr ON sr.source_id=s.id
     GROUP BY s.id,s.source_key,s.source_name,s.authority,s.source_class
     ORDER BY rank_records DESC,route_records DESC,association_records DESC,s.source_key`
  );

  const associationCandidates=await pool.query(
    `SELECT
       normalized_label,
       min(association_label) AS label,
       count(*)::int AS observations,
       count(DISTINCT taxi_rank_id)::int AS unique_ranks,
       array_agg(DISTINCT s.source_key ORDER BY s.source_key) AS sources
     FROM rank_association_candidate rac
     JOIN source_registry s ON s.id=rac.source_id
     GROUP BY normalized_label
     ORDER BY unique_ranks DESC,observations DESC,normalized_label
     LIMIT 500`
  );

  return {
    ...counts.rows[0],
    sources:sources.rows,
    associationCandidates:associationCandidates.rows
  };
}

async function postgisSourceRouteGeometries(url){
  const params=[];
  const where=["srg.geometry IS NOT NULL"];
  const bbox=url.searchParams.get('bbox');
  const province=url.searchParams.get('province');

  if(bbox){
    const parts=bbox.split(',').map(Number);
    if(parts.length===4 && parts.every(Number.isFinite)){
      params.push(parts[0],parts[1],parts[2],parts[3]);
      const n=params.length;
      where.push(`ST_Intersects(srg.geometry,ST_MakeEnvelope($${n-3},$${n-2},$${n-1},$${n},4326))`);
    }
  }

  if(province){
    params.push(province);
    where.push(`srg.province=$${params.length}`);
  }

  const result=await pool.query(
    `SELECT
       srg.id::text,
       srg.external_record_id,
       srg.route_code,
       srg.province,
       srg.municipality,
       srg.district,
       srg.category,
       srg.map_title,
       srg.verification_status::text,
       srg.promoted_route_id::text,
       ST_AsGeoJSON(srg.geometry)::json AS geometry,
       s.source_key,
       s.source_name,
       s.authority
     FROM source_route_geometry srg
     JOIN source_registry s ON s.id=srg.source_id
     WHERE ${where.join(' AND ')}
     ORDER BY srg.id
     LIMIT 10000`,
    params
  );

  return {
    type:'FeatureCollection',
    evidenceType:'official_source_route_geometry',
    notCanonicalRoute:true,
    features:result.rows.map(row=>({
      type:'Feature',
      id:row.id,
      geometry:row.geometry,
      properties:{
        id:row.id,
        externalRecordId:row.external_record_id,
        routeCode:row.route_code,
        province:row.province,
        municipality:row.municipality,
        district:row.district,
        category:row.category,
        mapTitle:row.map_title,
        verificationStatus:row.verification_status,
        promotedRouteId:row.promoted_route_id,
        sourceKey:row.source_key,
        source:row.source_name,
        authority:row.authority,
        notCanonicalRoute:true
      }
    }))
  };
}


async function postgisRouteCandidateAssociationEvidence(url){
  const params=[];
  const where=["rc.reconciliation_status='exact_endpoint_pair'"];
  const province=url.searchParams.get('province');

  if(province){
    params.push(province);
    where.push(`srg.province=$${params.length}`);
  }

  const result=await pool.query(
    `SELECT
       rc.id::text,
       rc.external_record_id,
       rc.route_code,
       o.id::text AS origin_rank_id,
       o.canonical_name AS origin_name,
       d.id::text AS destination_rank_id,
       d.canonical_name AS destination_name,
       coalesce(
         jsonb_agg(DISTINCT jsonb_build_object('id',oa.id::text,'name',oa.canonical_name))
           FILTER (WHERE oa.id IS NOT NULL),
         '[]'::jsonb
       ) AS origin_associations,
       coalesce(
         jsonb_agg(DISTINCT jsonb_build_object('id',da.id::text,'name',da.canonical_name))
           FILTER (WHERE da.id IS NOT NULL),
         '[]'::jsonb
       ) AS destination_associations
     FROM route_candidate rc
     JOIN source_route_geometry srg ON srg.id=rc.source_route_geometry_id
     JOIN taxi_rank o ON o.id=rc.origin_rank_id
     JOIN taxi_rank d ON d.id=rc.destination_rank_id
     LEFT JOIN taxi_rank_association ora ON ora.taxi_rank_id=rc.origin_rank_id
     LEFT JOIN taxi_association oa ON oa.id=ora.association_id
     LEFT JOIN taxi_rank_association dra ON dra.taxi_rank_id=rc.destination_rank_id
     LEFT JOIN taxi_association da ON da.id=dra.association_id
     WHERE ${where.join(' AND ')}
     GROUP BY rc.id,o.id,o.canonical_name,d.id,d.canonical_name
     ORDER BY rc.external_record_id
     LIMIT 10000`,
    params
  );

  const items=result.rows.map(row=>{
    const originIds=new Set(row.origin_associations.map(x=>x.id));
    const destinationIds=new Set(row.destination_associations.map(x=>x.id));
    const shared=[...originIds].filter(id=>destinationIds.has(id));
    let bucket='none';
    let eligibleForAutomaticAssignment=false;
    let sharedAssociation=null;

    if(shared.length===1){
      bucket='shared';
      eligibleForAutomaticAssignment=true;
      sharedAssociation=
        row.origin_associations.find(x=>x.id===shared[0]) ||
        row.destination_associations.find(x=>x.id===shared[0]) ||
        null;
    }else if(shared.length>1 || (originIds.size>0 && destinationIds.size>0)){
      bucket='conflicting';
    }else if(originIds.size>0){
      bucket='origin-only';
    }else if(destinationIds.size>0){
      bucket='destination-only';
    }

    return {
      routeCandidateId:row.id,
      externalRecordId:row.external_record_id,
      routeCode:row.route_code,
      origin:{id:row.origin_rank_id,name:row.origin_name,associations:row.origin_associations},
      destination:{id:row.destination_rank_id,name:row.destination_name,associations:row.destination_associations},
      bucket,
      eligibleForAutomaticAssignment,
      sharedAssociation,
      readOnly:true,
      canonicalRoutePromotion:false
    };
  });

  const buckets={shared:0,'origin-only':0,'destination-only':0,conflicting:0,none:0};
  for(const item of items) buckets[item.bucket]+=1;

  return {
    evidenceType:'route_candidate_endpoint_association_evidence',
    readOnly:true,
    canonicalRouteWrites:false,
    associationWrites:false,
    total:items.length,
    buckets,
    eligibleForAutomaticAssignment:items.filter(x=>x.eligibleForAutomaticAssignment).length,
    items
  };
}

async function postgisRouteCandidates(url){
  const params=[];
  const where=["rc.reconciliation_status='exact_endpoint_pair'"];
  const bbox=url.searchParams.get('bbox');
  const province=url.searchParams.get('province');

  if(bbox){
    const parts=bbox.split(',').map(Number);
    if(parts.length===4 && parts.every(Number.isFinite)){
      params.push(parts[0],parts[1],parts[2],parts[3]);
      const n=params.length;
      where.push(`ST_Intersects(srg.geometry,ST_MakeEnvelope($${n-3},$${n-2},$${n-1},$${n},4326))`);
    }
  }

  if(province){
    params.push(province);
    where.push(`srg.province=$${params.length}`);
  }

  const result=await pool.query(
    `SELECT
       rc.id::text,
       rc.external_record_id,
       rc.route_code,
       rc.origin_distance_m,
       rc.destination_distance_m,
       rc.reconciliation_status,
       rc.verification_status::text,
       rc.confidence,
       rc.provenance,
       o.id::text AS origin_rank_id,
       o.canonical_name AS origin_name,
       d.id::text AS destination_rank_id,
       d.canonical_name AS destination_name,
       a.id::text AS association_id,
       a.canonical_name AS association_name,
       srg.province,
       srg.municipality,
       srg.district,
       srg.category,
       srg.map_title,
       ST_AsGeoJSON(srg.geometry)::json AS geometry,
       s.source_key,
       s.source_name,
       s.authority
     FROM route_candidate rc
     JOIN source_route_geometry srg ON srg.id=rc.source_route_geometry_id
     JOIN source_registry s ON s.id=rc.source_id
     JOIN taxi_rank o ON o.id=rc.origin_rank_id
     JOIN taxi_rank d ON d.id=rc.destination_rank_id
     LEFT JOIN taxi_association a ON a.id=rc.association_id
     WHERE ${where.join(' AND ')}
     ORDER BY rc.id
     LIMIT 10000`,
    params
  );

  return {
    type:'FeatureCollection',
    evidenceType:'exact_route_candidate',
    notCanonicalRoute:true,
    features:result.rows.map(row=>({
      type:'Feature',
      id:row.id,
      geometry:row.geometry,
      properties:{
        id:row.id,
        externalRecordId:row.external_record_id,
        routeCode:row.route_code,
        originRankId:row.origin_rank_id,
        origin:row.origin_name,
        destinationRankId:row.destination_rank_id,
        destination:row.destination_name,
        originDistanceM:Number(row.origin_distance_m),
        destinationDistanceM:Number(row.destination_distance_m),
        reconciliationStatus:row.reconciliation_status,
        verificationStatus:row.verification_status,
        confidence:Number(row.confidence),
        association:row.association_name,
        associationId:row.association_id,
        province:row.province,
        municipality:row.municipality,
        district:row.district,
        category:row.category,
        mapTitle:row.map_title,
        sourceKey:row.source_key,
        source:row.source_name,
        authority:row.authority,
        candidateRoute:true,
        notCanonicalRoute:true
      }
    }))
  };
}

async function postgisRoutes(url){
  const params=[];
  const where=['tr.geometry IS NOT NULL'];
  const bbox=url.searchParams.get('bbox');
  const sourceKey=url.searchParams.get('source');

  if (bbox) {
    const parts=bbox.split(',').map(Number);
    if(parts.length===4 && parts.every(Number.isFinite)){
      params.push(parts[0],parts[1],parts[2],parts[3]);
      const n=params.length;
      where.push(`ST_Intersects(tr.geometry,ST_MakeEnvelope($${n-3},$${n-2},$${n-1},$${n},4326))`);
    }
  }

  if(sourceKey){
    params.push(sourceKey);
    where.push(`s.source_key = $${params.length}`);
  }

  const result=await pool.query(
    `SELECT
       tr.id::text,
       tr.origin_label,
       tr.destination_label,
       tr.route_name,
       tr.route_type,
       tr.national_route_code,
       tr.board_route_code,
       tr.geometry_status,
       tr.verification_status::text,
       ST_AsGeoJSON(tr.geometry)::json AS geometry,
       a.canonical_name AS association_name,
       a.registration_number AS association_registration,
       s.source_key,
       s.source_name
     FROM taxi_route tr
     LEFT JOIN LATERAL (
       SELECT source_id
       FROM source_record
       WHERE entity_type='taxi_route' AND entity_id=tr.id
       ORDER BY source_retrieved_at DESC
       LIMIT 1
     ) sr ON true
     LEFT JOIN source_registry s ON s.id=sr.source_id
     LEFT JOIN taxi_association a ON a.id=tr.association_id
     WHERE ${where.join(' AND ')}
     ORDER BY tr.id
     LIMIT 5000`,
    params
  );

  return {
    type:'FeatureCollection',
    features:result.rows.map(row => ({
      type:'Feature',
      id:row.id,
      geometry:row.geometry,
      properties:{
        id:row.id,
        origin:row.origin_label,
        destination:row.destination_label,
        name:row.route_name,
        routeType:row.route_type,
        nationalRouteCode:row.national_route_code,
        boardRouteCode:row.board_route_code,
        geometryStatus:row.geometry_status,
        verificationStatus:row.verification_status,
        association:row.association_name,
        associationRegistration:row.association_registration,
        sourceKey:row.source_key,
        source:row.source_name || 'PostGIS canonical'
      }
    }))
  };
}

async function postgisNltisEndpointEvidence(url){
  const params=[];
  const where=[
    "s.source_class='nltis_olas'",
    "tr.verification_status='documented'",
    "tr.origin_rank_id IS NOT NULL",
    "tr.destination_rank_id IS NOT NULL",
    "origin.location IS NOT NULL",
    "destination.location IS NOT NULL"
  ];
  const bbox=url.searchParams.get('bbox');
  const sourceKey=url.searchParams.get('source');

  if(bbox){
    const parts=bbox.split(',').map(Number);
    if(parts.length===4 && parts.every(Number.isFinite)){
      params.push(parts[0],parts[1],parts[2],parts[3]);
      const n=params.length;
      where.push(`ST_Intersects(ST_MakeLine(origin.location,destination.location),ST_MakeEnvelope($${n-3},$${n-2},$${n-1},$${n},4326))`);
    }
  }

  if(sourceKey){
    params.push(sourceKey);
    where.push(`s.source_key = $${params.length}`);
  }

  const result=await pool.query(
    `SELECT
       tr.id::text,
       tr.origin_label,
       tr.destination_label,
       tr.route_name,
       tr.route_type,
       tr.national_route_code,
       tr.board_route_code,
       tr.verification_status::text,
       ST_AsGeoJSON(ST_MakeLine(origin.location,destination.location))::json AS geometry,
       a.canonical_name AS association_name,
       a.registration_number AS association_registration,
       s.source_key,
       s.source_name
     FROM taxi_route tr
     JOIN taxi_rank origin ON origin.id=tr.origin_rank_id
     JOIN taxi_rank destination ON destination.id=tr.destination_rank_id
     JOIN taxi_association a ON a.id=tr.association_id
     JOIN LATERAL (
       SELECT registry.source_key,registry.source_name,registry.source_class
       FROM source_record sr
       JOIN source_registry registry ON registry.id=sr.source_id
       WHERE sr.entity_type='taxi_route' AND sr.entity_id=tr.id
       ORDER BY sr.source_retrieved_at DESC
       LIMIT 1
     ) s ON true
     WHERE ${where.join(' AND ')}
     ORDER BY tr.id
     LIMIT 5000`,
    params
  );

  return {
    type:'FeatureCollection',
    evidenceType:'nltis_exact_endpoint_connector',
    notRoutePath:true,
    features:result.rows.map(row=>({
      type:'Feature',
      id:row.id,
      geometry:row.geometry,
      properties:{
        id:row.id,
        origin:row.origin_label,
        destination:row.destination_label,
        name:row.route_name,
        routeType:row.route_type,
        nationalRouteCode:row.national_route_code,
        boardRouteCode:row.board_route_code,
        geometryStatus:'endpoint_connector_evidence',
        verificationStatus:row.verification_status,
        association:row.association_name,
        associationRegistration:row.association_registration,
        sourceKey:row.source_key,
        source:row.source_name || 'NLTIS / OLAS',
        evidenceOnly:true,
        exactEndpoints:true,
        notRoutePath:true
      }
    }))
  };
}

async function postgisAssociations(url){
  const params=[];
  const where=["coalesce(to_jsonb(a)->>'merged_into_association_id','')=''"];
  const province=url.searchParams.get('province');
  const q=url.searchParams.get('q');

  if(province){
    params.push(province);
    where.push(`a.province = $${params.length}`);
  }

  if(q){
    params.push('%' + q + '%');
    const i=params.length;
    where.push(`(a.canonical_name ILIKE $${i} OR coalesce(a.registration_number,'') ILIKE $${i} OR coalesce(a.acronym,'') ILIKE $${i})`);
  }

  const result=await pool.query(
    `SELECT
       a.id::text,
       a.canonical_name,
       a.acronym,
       a.registration_number,
       a.affiliation,
       a.province,
       a.municipality,
       a.address,
       a.verification_status::text,
       count(DISTINCT ra.taxi_rank_id)::int AS rank_count,
       count(DISTINCT tr.id)::int AS route_count
     FROM taxi_association a
     LEFT JOIN taxi_rank_association ra ON ra.association_id=a.id
     LEFT JOIN taxi_route tr ON tr.association_id=a.id
     WHERE ${where.join(' AND ')}
     GROUP BY a.id
     ORDER BY a.canonical_name
     LIMIT 5000`,
    params
  );

  return {items:result.rows};
}

async function postgisOperatorQualityQueue(url){
  const rawLimit=Number(url.searchParams.get('limit') || 100);
  const limit=Math.min(Math.max(Number.isFinite(rawLimit)?Math.floor(rawLimit):100,1),250);

  const [summary,issues,rankAssociationCandidates,routeCandidates]=await Promise.all([
    postgisDataQualitySummary(),
    postgisDataIssues(new URL('/api/v1/data-issues?limit='+limit,'http://localhost')),
    pool.query(
      `SELECT
         rac.id::text,
         rac.association_label,
         rac.normalized_label,
         rac.verification_status::text,
         rac.first_seen_at,
         rac.last_seen_at,
         r.id::text AS rank_id,
         r.canonical_name AS rank_name,
         r.town,
         r.municipality,
         r.province,
         CASE WHEN r.location IS NULL THEN NULL ELSE ST_X(r.location) END AS lng,
         CASE WHEN r.location IS NULL THEN NULL ELSE ST_Y(r.location) END AS lat,
         s.source_key,
         s.source_name,
         s.authority
       FROM rank_association_candidate rac
       JOIN source_registry s ON s.id=rac.source_id
       LEFT JOIN taxi_rank r ON r.id=rac.taxi_rank_id
       ORDER BY rac.last_seen_at DESC,rac.normalized_label
       LIMIT $1`,
      [limit]
    ),
    pool.query(
      `SELECT
         rc.id::text,
         rc.route_code,
         rc.reconciliation_status,
         rc.verification_status::text,
         rc.origin_distance_m,
         rc.destination_distance_m,
         rc.first_seen_at,
         rc.last_seen_at,
         origin.id::text AS origin_rank_id,
         origin.canonical_name AS origin_rank_name,
         destination.id::text AS destination_rank_id,
         destination.canonical_name AS destination_rank_name,
         s.source_key,
         s.source_name,
         s.authority
       FROM route_candidate rc
       JOIN source_registry s ON s.id=rc.source_id
       JOIN taxi_rank origin ON origin.id=rc.origin_rank_id
       JOIN taxi_rank destination ON destination.id=rc.destination_rank_id
       WHERE rc.association_id IS NULL
       ORDER BY rc.last_seen_at DESC,rc.route_code NULLS LAST,rc.id
       LIMIT $1`,
      [limit]
    )
  ]);

  return {
    mode:'operator_read_only',
    mutationEnabled:false,
    summary,
    dataIssues:issues.items,
    rankAssociationCandidates:rankAssociationCandidates.rows.map(row=>({
      id:row.id,
      associationLabel:row.association_label,
      normalizedLabel:row.normalized_label,
      verificationStatus:row.verification_status,
      firstSeenAt:row.first_seen_at,
      lastSeenAt:row.last_seen_at,
      rank:row.rank_id ? {
        id:row.rank_id,
        name:row.rank_name,
        town:row.town,
        municipality:row.municipality,
        province:row.province,
        lng:row.lng==null?null:Number(row.lng),
        lat:row.lat==null?null:Number(row.lat)
      } : null,
      source:{
        key:row.source_key,
        name:row.source_name,
        authority:row.authority
      }
    })),
    routeCandidatesWithoutAssociation:routeCandidates.rows.map(row=>({
      id:row.id,
      routeCode:row.route_code,
      reconciliationStatus:row.reconciliation_status,
      verificationStatus:row.verification_status,
      originDistanceM:Number(row.origin_distance_m),
      destinationDistanceM:Number(row.destination_distance_m),
      firstSeenAt:row.first_seen_at,
      lastSeenAt:row.last_seen_at,
      origin:{id:row.origin_rank_id,name:row.origin_rank_name},
      destination:{id:row.destination_rank_id,name:row.destination_rank_name},
      source:{
        key:row.source_key,
        name:row.source_name,
        authority:row.authority
      }
    }))
  };
}

function operatorAuthOrSend(req,res,roles){
  const auth=authenticateOperatorRequest(req,roles);
  if(auth.ok) return auth;

  if(auth.status===401){
    res.setHeader('www-authenticate','Bearer realm="transport-network-operator"');
  }
  send(res,auth.status,{
    error:auth.error,
    requiredRoles:auth.requiredRoles || undefined
  });
  return null;
}
async function readJsonBody(req,{maxBytes=16384}={}){
  let size=0;
  const chunks=[];
  for await (const chunk of req){
    size+=chunk.length;
    if(size>maxBytes){
      const error=new Error('request_body_too_large');
      error.status=413;
      throw error;
    }
    chunks.push(chunk);
  }

  if(!chunks.length) return {};
  const raw=Buffer.concat(chunks).toString('utf8');
  try{
    const value=JSON.parse(raw);
    if(!value || Array.isArray(value) || typeof value!=='object'){
      const error=new Error('invalid_json_body');
      error.status=400;
      throw error;
    }
    return value;
  }catch(error){
    if(error?.status) throw error;
    const wrapped=new Error('invalid_json_body');
    wrapped.status=400;
    throw wrapped;
  }
}

function normalizeIdempotencyKey(req){
  const raw=req.headers?.['idempotency-key'];
  if(typeof raw!=='string') return null;
  const value=raw.trim();
  if(value.length<8 || value.length>200) return null;
  if(!/^[A-Za-z0-9._:-]+$/.test(value)) return null;
  return value;
}

function requestId(req){
  const raw=req.headers?.['x-request-id'];
  if(typeof raw==='string'){
    const value=raw.trim();
    if(value && value.length<=200 && /^[A-Za-z0-9._:-]+$/.test(value)) return value;
  }
  return randomUUID();
}

function deferIssueEnabled(){
  return process.env.OPERATOR_DEFER_ISSUE_ENABLED==='true';
}

function rejectIssueEnabled(){
  return process.env.OPERATOR_REJECT_ISSUE_ENABLED==='true';
}

function reopenIssueEnabled(){
  return process.env.OPERATOR_REOPEN_ISSUE_ENABLED==='true';
}

async function existingActionAudit(client,actorSubject,action,idempotencyKey){
  const result=await client.query(
    `SELECT
       id::text,
       entity_id::text,
       before_state,
       after_state,
       event_sequence,
       occurred_at
     FROM operator_audit_event
     WHERE actor_subject=$1
       AND action=$2
       AND idempotency_key=$3
     LIMIT 1`,
    [actorSubject,action,idempotencyKey]
  );
  return result.rows[0] || null;
}

async function existingDeferAudit(client,actorSubject,idempotencyKey){
  return existingActionAudit(client,actorSubject,'data_issue.defer',idempotencyKey);
}

async function deferDataIssue({issueId,actor,idempotencyKey,rationale,evidence,expectedStatus,req}){
  if(!pool) return {status:503,payload:{error:'database_not_configured'}};
  if(!deferIssueEnabled()){
    return {
      status:503,
      payload:{
        error:'adjudication_defer_disabled',
        mutationEnabled:false
      }
    };
  }

  const client=await pool.connect();
  const action='data_issue.defer';
  const reqId=requestId(req);

  try{
    await client.query('BEGIN');

    const replayBeforeLock=await existingDeferAudit(client,actor.subject,idempotencyKey);
    if(replayBeforeLock){
      await client.query('COMMIT');
      return {
        status:200,
        payload:{
          replay:true,
          mutationEnabled:true,
          auditEventId:replayBeforeLock.id,
          issue:replayBeforeLock.after_state
        }
      };
    }

    const issueResult=await client.query(
      `SELECT
         id::text,
         entity_type,
         entity_id::text,
         issue_type,
         severity,
         summary,
         detail,
         status,
         created_at,
         resolved_at
       FROM data_issue
       WHERE id=$1::uuid
       FOR UPDATE`,
      [issueId]
    );

    const issue=issueResult.rows[0];
    if(!issue){
      await client.query('ROLLBACK');
      return {status:404,payload:{error:'data_issue_not_found'}};
    }

    const replayAfterLock=await existingDeferAudit(client,actor.subject,idempotencyKey);
    if(replayAfterLock){
      await client.query('COMMIT');
      return {
        status:200,
        payload:{
          replay:true,
          mutationEnabled:true,
          auditEventId:replayAfterLock.id,
          issue:replayAfterLock.after_state
        }
      };
    }

    if(issue.status!==expectedStatus){
      await client.query('ROLLBACK');
      return {
        status:409,
        payload:{
          error:'data_issue_status_conflict',
          expectedStatus,
          currentStatus:issue.status
        }
      };
    }

    if(!['open','reviewing'].includes(issue.status)){
      await client.query('ROLLBACK');
      return {
        status:409,
        payload:{
          error:'data_issue_not_deferable',
          currentStatus:issue.status
        }
      };
    }

    const updateResult=await client.query(
      `UPDATE data_issue
       SET status='deferred',
           resolved_at=NULL
       WHERE id=$1::uuid
         AND status=$2
       RETURNING
         id::text,
         entity_type,
         entity_id::text,
         issue_type,
         severity,
         summary,
         detail,
         status,
         created_at,
         resolved_at`,
      [issueId,expectedStatus]
    );

    const after=updateResult.rows[0];
    if(!after){
      await client.query('ROLLBACK');
      return {
        status:409,
        payload:{
          error:'data_issue_status_conflict',
          expectedStatus
        }
      };
    }

    const audit=await appendOperatorAuditEvent(client,{
      actor,
      action,
      entityType:'data_issue',
      entityId:issueId,
      requestId:reqId,
      idempotencyKey,
      beforeState:issue,
      afterState:after,
      evidence,
      rationale,
      metadata:{
        gate:'TN7-ADJUDICATION-1',
        expectedStatus
      }
    });

    await client.query('COMMIT');

    return {
      status:200,
      payload:{
        replay:false,
        mutationEnabled:true,
        auditEventId:audit.id,
        occurredAt:audit.occurred_at,
        issue:after
      }
    };
  }catch(error){
    try{ await client.query('ROLLBACK'); }catch{}
    throw error;
  }finally{
    client.release();
  }
}



async function rejectDataIssue({issueId,actor,idempotencyKey,rationale,evidence,expectedStatus,req}){
  if(!pool) return {status:503,payload:{error:'database_not_configured'}};
  if(!rejectIssueEnabled()){
    return {
      status:503,
      payload:{error:'adjudication_reject_disabled',mutationEnabled:false}
    };
  }

  const client=await pool.connect();
  const action='data_issue.reject';
  const reqId=requestId(req);

  try{
    await client.query('BEGIN');

    const replayBeforeLock=await existingActionAudit(client,actor.subject,action,idempotencyKey);
    if(replayBeforeLock){
      await client.query('COMMIT');
      return {
        status:200,
        payload:{
          replay:true,
          mutationEnabled:true,
          auditEventId:replayBeforeLock.id,
          issue:replayBeforeLock.after_state
        }
      };
    }

    const issueResult=await client.query(
      `SELECT
         id::text,
         entity_type,
         entity_id::text,
         issue_type,
         severity,
         summary,
         detail,
         status,
         created_at,
         resolved_at
       FROM data_issue
       WHERE id=$1::uuid
       FOR UPDATE`,
      [issueId]
    );

    const issue=issueResult.rows[0];
    if(!issue){
      await client.query('ROLLBACK');
      return {status:404,payload:{error:'data_issue_not_found'}};
    }

    const replayAfterLock=await existingActionAudit(client,actor.subject,action,idempotencyKey);
    if(replayAfterLock){
      await client.query('COMMIT');
      return {
        status:200,
        payload:{
          replay:true,
          mutationEnabled:true,
          auditEventId:replayAfterLock.id,
          issue:replayAfterLock.after_state
        }
      };
    }

    if(issue.status!==expectedStatus){
      await client.query('ROLLBACK');
      return {
        status:409,
        payload:{error:'data_issue_status_conflict',expectedStatus,currentStatus:issue.status}
      };
    }

    if(!['open','reviewing','deferred'].includes(issue.status)){
      await client.query('ROLLBACK');
      return {
        status:409,
        payload:{error:'data_issue_not_rejectable',currentStatus:issue.status}
      };
    }

    const updateResult=await client.query(
      `UPDATE data_issue
       SET status='rejected',
           resolved_at=now()
       WHERE id=$1::uuid
         AND status=$2
       RETURNING
         id::text,
         entity_type,
         entity_id::text,
         issue_type,
         severity,
         summary,
         detail,
         status,
         created_at,
         resolved_at`,
      [issueId,expectedStatus]
    );

    const after=updateResult.rows[0];
    if(!after){
      await client.query('ROLLBACK');
      return {status:409,payload:{error:'data_issue_status_conflict',expectedStatus}};
    }

    const audit=await appendOperatorAuditEvent(client,{
      actor,
      action,
      entityType:'data_issue',
      entityId:issueId,
      requestId:reqId,
      idempotencyKey,
      beforeState:issue,
      afterState:after,
      evidence,
      rationale,
      metadata:{gate:'TN7-ADJUDICATION-2',expectedStatus}
    });

    await client.query('COMMIT');

    return {
      status:200,
      payload:{
        replay:false,
        mutationEnabled:true,
        auditEventId:audit.id,
        occurredAt:audit.occurred_at,
        issue:after
      }
    };
  }catch(error){
    try{ await client.query('ROLLBACK'); }catch{}
    throw error;
  }finally{
    client.release();
  }
}

async function reopenDataIssue({issueId,actor,idempotencyKey,rationale,evidence,expectedStatus,priorAuditEventId,req}){
  if(!pool) return {status:503,payload:{error:'database_not_configured'}};
  if(!reopenIssueEnabled()){
    return {
      status:503,
      payload:{error:'adjudication_reopen_disabled',mutationEnabled:false}
    };
  }

  const client=await pool.connect();
  const action='data_issue.reopen';
  const reqId=requestId(req);

  try{
    await client.query('BEGIN');

    const replayBeforeLock=await existingActionAudit(client,actor.subject,action,idempotencyKey);
    if(replayBeforeLock){
      await client.query('COMMIT');
      return {
        status:200,
        payload:{
          replay:true,
          mutationEnabled:true,
          auditEventId:replayBeforeLock.id,
          issue:replayBeforeLock.after_state
        }
      };
    }

    const issueResult=await client.query(
      `SELECT
         id::text,
         entity_type,
         entity_id::text,
         issue_type,
         severity,
         summary,
         detail,
         status,
         created_at,
         resolved_at
       FROM data_issue
       WHERE id=$1::uuid
       FOR UPDATE`,
      [issueId]
    );
    const issue=issueResult.rows[0];

    if(!issue){
      await client.query('ROLLBACK');
      return {status:404,payload:{error:'data_issue_not_found'}};
    }

    const replayAfterLock=await existingActionAudit(client,actor.subject,action,idempotencyKey);
    if(replayAfterLock){
      await client.query('COMMIT');
      return {
        status:200,
        payload:{
          replay:true,
          mutationEnabled:true,
          auditEventId:replayAfterLock.id,
          issue:replayAfterLock.after_state
        }
      };
    }

    if(issue.status!==expectedStatus){
      await client.query('ROLLBACK');
      return {
        status:409,
        payload:{error:'data_issue_status_conflict',expectedStatus,currentStatus:issue.status}
      };
    }

    if(!['deferred','rejected'].includes(issue.status)){
      await client.query('ROLLBACK');
      return {
        status:409,
        payload:{error:'data_issue_not_reopenable',currentStatus:issue.status}
      };
    }

    const priorResult=await client.query(
      `SELECT
         id::text,
         actor_subject,
         action,
         entity_id::text,
         before_state,
         after_state,
         event_sequence,
         occurred_at
       FROM operator_audit_event
       WHERE id=$1::uuid
         AND entity_type='data_issue'
         AND entity_id=$2::uuid
       LIMIT 1`,
      [priorAuditEventId,issueId]
    );
    const prior=priorResult.rows[0];

    if(!prior || !['data_issue.defer','data_issue.reject'].includes(prior.action)){
      await client.query('ROLLBACK');
      return {status:409,payload:{error:'prior_adjudication_not_reversible'}};
    }

    const latestResult=await client.query(
      `SELECT id::text,action,event_sequence,occurred_at
       FROM operator_audit_event
       WHERE entity_type='data_issue'
         AND entity_id=$1::uuid
         AND action IN ('data_issue.defer','data_issue.reject','data_issue.reopen')
       ORDER BY event_sequence DESC
       LIMIT 1`,
      [issueId]
    );
    const latest=latestResult.rows[0];

    if(!latest || latest.id!==priorAuditEventId){
      await client.query('ROLLBACK');
      return {
        status:409,
        payload:{
          error:'prior_adjudication_not_latest',
          latestAuditEventId:latest?.id || null
        }
      };
    }

    if(prior.after_state?.status!==issue.status){
      await client.query('ROLLBACK');
      return {
        status:409,
        payload:{
          error:'prior_adjudication_state_mismatch',
          priorAfterStatus:prior.after_state?.status || null,
          currentStatus:issue.status
        }
      };
    }

    const restoreStatus=prior.before_state?.status;
    if(!['open','reviewing'].includes(restoreStatus)){
      await client.query('ROLLBACK');
      return {
        status:409,
        payload:{error:'prior_adjudication_restore_state_invalid',restoreStatus:restoreStatus || null}
      };
    }

    const updateResult=await client.query(
      `UPDATE data_issue
       SET status=$2,
           resolved_at=NULL
       WHERE id=$1::uuid
         AND status=$3
       RETURNING
         id::text,
         entity_type,
         entity_id::text,
         issue_type,
         severity,
         summary,
         detail,
         status,
         created_at,
         resolved_at`,
      [issueId,restoreStatus,expectedStatus]
    );
    const after=updateResult.rows[0];

    if(!after){
      await client.query('ROLLBACK');
      return {status:409,payload:{error:'data_issue_status_conflict',expectedStatus}};
    }

    const audit=await appendOperatorAuditEvent(client,{
      actor,
      action,
      entityType:'data_issue',
      entityId:issueId,
      requestId:reqId,
      idempotencyKey,
      beforeState:issue,
      afterState:after,
      evidence,
      rationale,
      metadata:{
        gate:'TN7-ADJUDICATION-2',
        expectedStatus,
        reversesAuditEventId:priorAuditEventId,
        reversedAction:prior.action,
        restoredStatus:restoreStatus
      }
    });

    await client.query('COMMIT');

    return {
      status:200,
      payload:{
        replay:false,
        mutationEnabled:true,
        auditEventId:audit.id,
        occurredAt:audit.occurred_at,
        reversedAuditEventId:priorAuditEventId,
        restoredStatus:restoreStatus,
        issue:after
      }
    };
  }catch(error){
    try{ await client.query('ROLLBACK'); }catch{}
    throw error;
  }finally{
    client.release();
  }
}


async function postgisDataIssues(url){
  const params=[];
  const where=["status IN ('open','reviewing','deferred')"];
  const issueType=url.searchParams.get('issueType');
  const sourceKey=url.searchParams.get('source');
  const limit=Math.min(Math.max(Number(url.searchParams.get('limit') || 200),1),1000);

  if(issueType){
    params.push(issueType);
    where.push(`issue_type = $${params.length}`);
  }

  if(sourceKey){
    params.push(sourceKey);
    where.push(`detail->>'sourceKey' = $${params.length}`);
  }

  params.push(limit);

  const result=await pool.query(
    `SELECT
       id::text,
       entity_type,
       entity_id::text,
       issue_type,
       severity,
       summary,
       detail,
       status,
       created_at,
       resolved_at
     FROM data_issue
     WHERE ${where.join(' AND ')}
     ORDER BY
       CASE severity WHEN 'blocking' THEN 1 WHEN 'error' THEN 2 WHEN 'warning' THEN 3 ELSE 4 END,
       created_at DESC
     LIMIT $${params.length}`,
    params
  );

  return {items:result.rows};
}

async function postgisRankReconciliation(url){
  const sourceA=url.searchParams.get('sourceA') || 'ethekwini-bus-taxi-ranks-degraded';
  const sourceB=url.searchParams.get('sourceB') || 'kzn-taxi-ranks-degraded-tls';
  const requested=Number(url.searchParams.get('maxDistance') || 100);
  const maxDistance=Math.min(Math.max(Number.isFinite(requested)?requested:100,1),500);

  const result=await pool.query(
    `WITH source_a AS (
       SELECT DISTINCT
         r.id,
         r.canonical_name,
         r.location,
         sr.external_record_id
       FROM taxi_rank r
       JOIN source_record sr
         ON sr.entity_type='taxi_rank' AND sr.entity_id=r.id
       JOIN source_registry s ON s.id=sr.source_id
       WHERE s.source_key=$1
         AND r.location IS NOT NULL
     ),
     source_b AS (
       SELECT DISTINCT
         r.id,
         r.canonical_name,
         r.location,
         sr.external_record_id
       FROM taxi_rank r
       JOIN source_record sr
         ON sr.entity_type='taxi_rank' AND sr.entity_id=r.id
       JOIN source_registry s ON s.id=sr.source_id
       WHERE s.source_key=$2
         AND r.location IS NOT NULL
     ),
     nearest AS (
       SELECT
         a.id AS source_a_rank_id,
         a.canonical_name AS source_a_name,
         a.external_record_id AS source_a_external_id,
         ST_X(a.location) AS source_a_lng,
         ST_Y(a.location) AS source_a_lat,
         b.id AS source_b_rank_id,
         b.canonical_name AS source_b_name,
         b.external_record_id AS source_b_external_id,
         ST_X(b.location) AS source_b_lng,
         ST_Y(b.location) AS source_b_lat,
         ST_DistanceSphere(a.location,b.location) AS distance_m
       FROM source_a a
       CROSS JOIN LATERAL (
         SELECT b.*
         FROM source_b b
         ORDER BY a.location <-> b.location
         LIMIT 1
       ) b
     ),
     within_100 AS (
       SELECT
         a.id AS source_a_rank_id,
         count(*)::int AS candidates_within_100m
       FROM source_a a
       JOIN source_b b
         ON ST_DWithin(a.location::geography,b.location::geography,100)
       GROUP BY a.id
     )
     SELECT
       n.*,
       coalesce(w.candidates_within_100m,0) AS candidates_within_100m
     FROM nearest n
     LEFT JOIN within_100 w ON w.source_a_rank_id=n.source_a_rank_id
     ORDER BY n.distance_m, n.source_a_name`,
    [sourceA,sourceB]
  );

  const rows=result.rows.map(row=>({
    sourceA:{
      id:row.source_a_rank_id,
      name:row.source_a_name,
      externalId:row.source_a_external_id,
      coordinates:[Number(row.source_a_lng),Number(row.source_a_lat)]
    },
    sourceB:{
      id:row.source_b_rank_id,
      name:row.source_b_name,
      externalId:row.source_b_external_id,
      coordinates:[Number(row.source_b_lng),Number(row.source_b_lat)]
    },
    distanceM:Number(Number(row.distance_m).toFixed(2)),
    candidatesWithin100m:Number(row.candidates_within_100m)
  }));

  const buckets={
    lt25:0,
    m25to50:0,
    m50to100:0,
    m100to200:0,
    gte200:0
  };
  for(const row of rows){
    const d=row.distanceM;
    if(d<25) buckets.lt25+=1;
    else if(d<50) buckets.m25to50+=1;
    else if(d<100) buckets.m50to100+=1;
    else if(d<200) buckets.m100to200+=1;
    else buckets.gte200+=1;
  }

  return {
    sourceA,
    sourceB,
    sourceACount:rows.length,
    maxDistanceM:maxDistance,
    nearestDistanceBuckets:buckets,
    ambiguousWithin100m:rows.filter(row=>row.candidatesWithin100m>1).length,
    candidates:rows.filter(row=>row.distanceM<=maxDistance)
  };
}

async function meta(){
  if (!pool) {
    return {mode:'unconfigured',ranks:0,associations:0,routes:0,sources:0,productionComplete:false};
  }

  const result=await pool.query(
    `SELECT
       (SELECT count(*)::int FROM taxi_rank r WHERE coalesce(to_jsonb(r)->>'merged_into_rank_id','')='') AS ranks,
       (SELECT count(*)::int FROM taxi_rank r WHERE r.location IS NOT NULL AND coalesce(to_jsonb(r)->>'merged_into_rank_id','')='') AS mapped_ranks,
       (SELECT count(*)::int FROM taxi_rank r WHERE r.location IS NULL AND coalesce(to_jsonb(r)->>'merged_into_rank_id','')='') AS location_pending_ranks,
       (SELECT count(*)::int FROM taxi_association) AS associations,
       (SELECT count(*)::int FROM taxi_route) AS routes,
       (SELECT count(*)::int FROM source_registry) AS sources,
       (SELECT count(*)::int FROM data_issue WHERE status IN ('open','reviewing','deferred')) AS open_issues`
  );
  return {mode:'postgis',...result.rows[0],productionComplete:false};
}

async function rankDetail(id){
  if (!pool) return null;

  const rank=await pool.query(
    `SELECT
       r.id::text,
       r.canonical_name AS "sourceCode",
       r.aliases,
       coalesce(nullif(r.aliases[1],''),r.canonical_name) AS "displayName",
       r.address,
       r.town,
       r.municipality,
       r.province,
       r.verification_status::text AS "verificationStatus",
       ST_X(r.location) AS lng,
       ST_Y(r.location) AS lat
     FROM taxi_rank r
     WHERE r.id=$1::uuid
       AND coalesce(to_jsonb(r)->>'merged_into_rank_id','')=''`,
    [id]
  );

  if (!rank.rows[0]) return null;

  const sources=await pool.query(
    `SELECT
       s.source_key,
       s.source_name,
       s.authority,
       sr.external_record_id,
       sr.source_last_checked_at
     FROM source_record sr
     JOIN source_registry s ON s.id=sr.source_id
     WHERE sr.entity_type='taxi_rank' AND sr.entity_id=$1::uuid
     ORDER BY sr.source_retrieved_at DESC`,
    [id]
  );

  const associations=await pool.query(
    `SELECT
       a.id::text,
       a.canonical_name AS name,
       a.acronym,
       a.registration_number,
       a.verification_status::text AS "verificationStatus"
     FROM taxi_rank_association ra
     JOIN taxi_association a ON a.id=ra.association_id
     WHERE ra.taxi_rank_id=$1::uuid
     ORDER BY a.canonical_name`,
    [id]
  );

  const routes=await pool.query(
    `SELECT
       tr.id::text,
       tr.origin_label AS origin,
       tr.destination_label AS destination,
       tr.route_name AS name,
       tr.national_route_code AS "nationalRouteCode",
       tr.board_route_code AS "boardRouteCode",
       tr.geometry_status AS "geometryStatus",
       tr.verification_status::text AS "verificationStatus",
       a.canonical_name AS association
     FROM taxi_route tr
     LEFT JOIN taxi_association a ON a.id=tr.association_id
     WHERE tr.origin_rank_id=$1::uuid OR tr.destination_rank_id=$1::uuid
     ORDER BY tr.route_name
     LIMIT 500`,
    [id]
  );

  const candidateCounts=await pool.query(
    `SELECT
       count(*)::int AS total,
       count(*) FILTER (WHERE origin_rank_id=$1::uuid)::int AS origin,
       count(*) FILTER (WHERE destination_rank_id=$1::uuid)::int AS destination
     FROM route_candidate
     WHERE origin_rank_id=$1::uuid OR destination_rank_id=$1::uuid`,
    [id]
  );

  return {
    ...rank.rows[0],
    name:rank.rows[0].displayName,
    sources:sources.rows,
    associations:associations.rows,
    routes:routes.rows,
    routeCandidateCounts:candidateCounts.rows[0] || {total:0,origin:0,destination:0}
  };
}

const server=createServer(async(req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host || 'localhost'}`);
  const method=req.method || 'GET';

  try{
    if(url.pathname==='/api/v1/operator/proposals/association-merges'){
      if(method!=='POST'){
        res.setHeader('allow','POST');
        return send(res,405,{error:'method_not_allowed'});
      }

      const auth=operatorAuthOrSend(req,res,['reviewer','approver','admin']);
      if(!auth) return;

      const idempotencyKey=normalizeIdempotencyKey(req);
      if(!idempotencyKey) return send(res,400,{error:'idempotency_key_required'});

      const body=await readJsonBody(req);
      const survivorAssociationId=typeof body.survivorAssociationId==='string' ? body.survivorAssociationId.trim() : '';
      const duplicateAssociationId=typeof body.duplicateAssociationId==='string' ? body.duplicateAssociationId.trim() : '';
      const rationale=typeof body.rationale==='string' ? body.rationale.trim() : '';
      const evidence=body.evidence && typeof body.evidence==='object' && !Array.isArray(body.evidence)
        ? body.evidence
        : {};

      if(!/^[0-9a-fA-F-]{36}$/.test(survivorAssociationId) || !/^[0-9a-fA-F-]{36}$/.test(duplicateAssociationId)){
        return send(res,400,{error:'association_merge_ids_required'});
      }
      if(rationale.length<10 || rationale.length>2000){
        return send(res,400,{error:'proposal_rationale_required'});
      }
      if(Object.keys(evidence).length===0){
        return send(res,400,{error:'proposal_evidence_required'});
      }

      const result=await createTaxiAssociationMergeProposal(pool,{
        survivorAssociationId,
        duplicateAssociationId,
        actor:auth.actor,
        idempotencyKey,
        rationale,
        evidence,
        requestId:requestId(req)
      });
      return send(res,result.status,result.payload);
    }

    if(url.pathname==='/api/v1/operator/proposals/rank-merges'){
      if(method!=='POST'){
        res.setHeader('allow','POST');
        return send(res,405,{error:'method_not_allowed'});
      }

      const auth=operatorAuthOrSend(req,res,['reviewer','approver','admin']);
      if(!auth) return;

      const idempotencyKey=normalizeIdempotencyKey(req);
      if(!idempotencyKey) return send(res,400,{error:'idempotency_key_required'});

      const body=await readJsonBody(req);
      const survivorRankId=typeof body.survivorRankId==='string' ? body.survivorRankId.trim() : '';
      const duplicateRankId=typeof body.duplicateRankId==='string' ? body.duplicateRankId.trim() : '';
      const rationale=typeof body.rationale==='string' ? body.rationale.trim() : '';
      const evidence=body.evidence && typeof body.evidence==='object' && !Array.isArray(body.evidence)
        ? body.evidence
        : {};

      if(!/^[0-9a-fA-F-]{36}$/.test(survivorRankId) || !/^[0-9a-fA-F-]{36}$/.test(duplicateRankId)){
        return send(res,400,{error:'rank_merge_ids_required'});
      }
      if(rationale.length<10 || rationale.length>2000){
        return send(res,400,{error:'proposal_rationale_required'});
      }
      if(Object.keys(evidence).length===0){
        return send(res,400,{error:'proposal_evidence_required'});
      }

      const result=await createTaxiRankMergeProposal(pool,{
        survivorRankId,
        duplicateRankId,
        actor:auth.actor,
        idempotencyKey,
        rationale,
        evidence,
        requestId:requestId(req)
      });
      return send(res,result.status,result.payload);
    }

    const createRoutePromotionProposalMatch=url.pathname.match(/^\/api\/v1\/operator\/proposals\/route-candidates\/([0-9a-fA-F-]{36})\/promote$/);
    if(createRoutePromotionProposalMatch){
      if(method!=='POST'){
        res.setHeader('allow','POST');
        return send(res,405,{error:'method_not_allowed'});
      }

      const auth=operatorAuthOrSend(req,res,['reviewer','approver','admin']);
      if(!auth) return;

      const idempotencyKey=normalizeIdempotencyKey(req);
      if(!idempotencyKey) return send(res,400,{error:'idempotency_key_required'});

      const body=await readJsonBody(req);
      const associationId=typeof body.associationId==='string' ? body.associationId.trim() : '';
      const rationale=typeof body.rationale==='string' ? body.rationale.trim() : '';
      const evidence=body.evidence && typeof body.evidence==='object' && !Array.isArray(body.evidence)
        ? body.evidence
        : {};

      if(!/^[0-9a-fA-F-]{36}$/.test(associationId)){
        return send(res,400,{error:'association_id_required'});
      }
      if(rationale.length<10 || rationale.length>2000){
        return send(res,400,{error:'proposal_rationale_required'});
      }
      if(Object.keys(evidence).length===0){
        return send(res,400,{error:'proposal_evidence_required'});
      }

      const result=await createRoutePromotionProposal(pool,{
        candidateId:createRoutePromotionProposalMatch[1],
        associationId,
        actor:auth.actor,
        idempotencyKey,
        rationale,
        evidence,
        requestId:requestId(req)
      });
      return send(res,result.status,result.payload);
    }

    const createRankAssociationProposalMatch=url.pathname.match(/^\/api\/v1\/operator\/proposals\/rank-association-candidates\/([0-9a-fA-F-]{36})\/assign$/);
    if(createRankAssociationProposalMatch){
      if(method!=='POST'){
        res.setHeader('allow','POST');
        return send(res,405,{error:'method_not_allowed'});
      }

      const auth=operatorAuthOrSend(req,res,['reviewer','approver','admin']);
      if(!auth) return;

      const idempotencyKey=normalizeIdempotencyKey(req);
      if(!idempotencyKey) return send(res,400,{error:'idempotency_key_required'});

      const body=await readJsonBody(req);
      const associationId=typeof body.associationId==='string' ? body.associationId.trim() : '';
      const rationale=typeof body.rationale==='string' ? body.rationale.trim() : '';
      const evidence=body.evidence && typeof body.evidence==='object' && !Array.isArray(body.evidence)
        ? body.evidence
        : {};

      if(!/^[0-9a-fA-F-]{36}$/.test(associationId)){
        return send(res,400,{error:'association_id_required'});
      }
      if(rationale.length<10 || rationale.length>2000){
        return send(res,400,{error:'proposal_rationale_required'});
      }
      if(Object.keys(evidence).length===0){
        return send(res,400,{error:'proposal_evidence_required'});
      }

      const result=await createRankAssociationAssignmentProposal(pool,{
        candidateId:createRankAssociationProposalMatch[1],
        associationId,
        actor:auth.actor,
        idempotencyKey,
        rationale,
        evidence,
        requestId:requestId(req)
      });
      return send(res,result.status,result.payload);
    }

    const createRankAliasProposalMatch=url.pathname.match(/^\/api\/v1\/operator\/proposals\/ranks\/([0-9a-fA-F-]{36})\/aliases$/);
    if(createRankAliasProposalMatch){
      if(method!=='POST'){
        res.setHeader('allow','POST');
        return send(res,405,{error:'method_not_allowed'});
      }

      const auth=operatorAuthOrSend(req,res,['reviewer','approver','admin']);
      if(!auth) return;

      const idempotencyKey=normalizeIdempotencyKey(req);
      if(!idempotencyKey) return send(res,400,{error:'idempotency_key_required'});

      const body=await readJsonBody(req);
      const alias=typeof body.alias==='string' ? body.alias : '';
      const rationale=typeof body.rationale==='string' ? body.rationale.trim() : '';
      const evidence=body.evidence && typeof body.evidence==='object' && !Array.isArray(body.evidence)
        ? body.evidence
        : {};

      if(rationale.length<10 || rationale.length>2000){
        return send(res,400,{error:'proposal_rationale_required'});
      }
      if(Object.keys(evidence).length===0){
        return send(res,400,{error:'proposal_evidence_required'});
      }

      const result=await createAliasProposal(pool,{
        entityType:'taxi_rank',
        entityId:createRankAliasProposalMatch[1],
        alias,
        actor:auth.actor,
        idempotencyKey,
        rationale,
        evidence,
        requestId:requestId(req)
      });
      return send(res,result.status,result.payload);
    }

    const createAssociationAliasProposalMatch=url.pathname.match(/^\/api\/v1\/operator\/proposals\/associations\/([0-9a-fA-F-]{36})\/aliases$/);
    if(createAssociationAliasProposalMatch){
      if(method!=='POST'){
        res.setHeader('allow','POST');
        return send(res,405,{error:'method_not_allowed'});
      }

      const auth=operatorAuthOrSend(req,res,['reviewer','approver','admin']);
      if(!auth) return;

      const idempotencyKey=normalizeIdempotencyKey(req);
      if(!idempotencyKey) return send(res,400,{error:'idempotency_key_required'});

      const body=await readJsonBody(req);
      const alias=typeof body.alias==='string' ? body.alias : '';
      const rationale=typeof body.rationale==='string' ? body.rationale.trim() : '';
      const evidence=body.evidence && typeof body.evidence==='object' && !Array.isArray(body.evidence)
        ? body.evidence
        : {};

      if(rationale.length<10 || rationale.length>2000){
        return send(res,400,{error:'proposal_rationale_required'});
      }
      if(Object.keys(evidence).length===0){
        return send(res,400,{error:'proposal_evidence_required'});
      }

      const result=await createAliasProposal(pool,{
        entityType:'taxi_association',
        entityId:createAssociationAliasProposalMatch[1],
        alias,
        actor:auth.actor,
        idempotencyKey,
        rationale,
        evidence,
        requestId:requestId(req)
      });
      return send(res,result.status,result.payload);
    }

    const createDeferProposalMatch=url.pathname.match(/^\/api\/v1\/operator\/proposals\/data-issues\/([0-9a-fA-F-]{36})\/defer$/);
    if(createDeferProposalMatch){
      if(method!=='POST'){
        res.setHeader('allow','POST');
        return send(res,405,{error:'method_not_allowed'});
      }

      const auth=operatorAuthOrSend(req,res,['reviewer','approver','admin']);
      if(!auth) return;

      const idempotencyKey=normalizeIdempotencyKey(req);
      if(!idempotencyKey) return send(res,400,{error:'idempotency_key_required'});

      const body=await readJsonBody(req);
      const rationale=typeof body.rationale==='string' ? body.rationale.trim() : '';
      const expectedStatus=typeof body.expectedStatus==='string' ? body.expectedStatus.trim() : '';
      const evidence=body.evidence && typeof body.evidence==='object' && !Array.isArray(body.evidence)
        ? body.evidence
        : {};

      if(rationale.length<10 || rationale.length>2000){
        return send(res,400,{error:'proposal_rationale_required'});
      }
      if(Object.keys(evidence).length===0){
        return send(res,400,{error:'proposal_evidence_required'});
      }
      if(!['open','reviewing'].includes(expectedStatus)){
        return send(res,400,{error:'expected_status_required'});
      }

      const result=await createDataIssueDeferProposal(pool,{
        issueId:createDeferProposalMatch[1],
        actor:auth.actor,
        idempotencyKey,
        rationale,
        evidence,
        expectedStatus,
        requestId:requestId(req)
      });
      return send(res,result.status,result.payload);
    }

    const approveProposalMatch=url.pathname.match(/^\/api\/v1\/operator\/proposals\/([0-9a-fA-F-]{36})\/approve$/);
    if(approveProposalMatch){
      if(method!=='POST'){
        res.setHeader('allow','POST');
        return send(res,405,{error:'method_not_allowed'});
      }

      const auth=operatorAuthOrSend(req,res,['approver','admin']);
      if(!auth) return;

      const idempotencyKey=normalizeIdempotencyKey(req);
      if(!idempotencyKey) return send(res,400,{error:'idempotency_key_required'});

      const body=await readJsonBody(req);
      const rationale=typeof body.rationale==='string' ? body.rationale.trim() : '';
      const evidence=body.evidence && typeof body.evidence==='object' && !Array.isArray(body.evidence)
        ? body.evidence
        : {};

      if(rationale.length<10 || rationale.length>2000){
        return send(res,400,{error:'decision_rationale_required'});
      }
      if(Object.keys(evidence).length===0){
        return send(res,400,{error:'decision_evidence_required'});
      }

      const result=await approveDecisionProposal(pool,{
        proposalId:approveProposalMatch[1],
        actor:auth.actor,
        idempotencyKey,
        rationale,
        evidence,
        requestId:requestId(req)
      });
      return send(res,result.status,result.payload);
    }

    const rejectProposalMatch=url.pathname.match(/^\/api\/v1\/operator\/proposals\/([0-9a-fA-F-]{36})\/reject$/);
    if(rejectProposalMatch){
      if(method!=='POST'){
        res.setHeader('allow','POST');
        return send(res,405,{error:'method_not_allowed'});
      }

      const auth=operatorAuthOrSend(req,res,['approver','admin']);
      if(!auth) return;

      const idempotencyKey=normalizeIdempotencyKey(req);
      if(!idempotencyKey) return send(res,400,{error:'idempotency_key_required'});

      const body=await readJsonBody(req);
      const rationale=typeof body.rationale==='string' ? body.rationale.trim() : '';
      const evidence=body.evidence && typeof body.evidence==='object' && !Array.isArray(body.evidence)
        ? body.evidence
        : {};

      if(rationale.length<10 || rationale.length>2000){
        return send(res,400,{error:'decision_rationale_required'});
      }
      if(Object.keys(evidence).length===0){
        return send(res,400,{error:'decision_evidence_required'});
      }

      const result=await rejectDecisionProposal(pool,{
        proposalId:rejectProposalMatch[1],
        actor:auth.actor,
        idempotencyKey,
        rationale,
        evidence,
        requestId:requestId(req)
      });
      return send(res,result.status,result.payload);
    }

    const withdrawProposalMatch=url.pathname.match(/^\/api\/v1\/operator\/proposals\/([0-9a-fA-F-]{36})\/withdraw$/);
    if(withdrawProposalMatch){
      if(method!=='POST'){
        res.setHeader('allow','POST');
        return send(res,405,{error:'method_not_allowed'});
      }

      const auth=operatorAuthOrSend(req,res,['reviewer','approver','admin']);
      if(!auth) return;

      const idempotencyKey=normalizeIdempotencyKey(req);
      if(!idempotencyKey) return send(res,400,{error:'idempotency_key_required'});

      const body=await readJsonBody(req);
      const rationale=typeof body.rationale==='string' ? body.rationale.trim() : '';
      const evidence=body.evidence && typeof body.evidence==='object' && !Array.isArray(body.evidence)
        ? body.evidence
        : {};

      if(rationale.length<10 || rationale.length>2000){
        return send(res,400,{error:'decision_rationale_required'});
      }

      const result=await withdrawDecisionProposal(pool,{
        proposalId:withdrawProposalMatch[1],
        actor:auth.actor,
        idempotencyKey,
        rationale,
        evidence,
        requestId:requestId(req)
      });
      return send(res,result.status,result.payload);
    }

    const deferMatch=url.pathname.match(/^\/api\/v1\/operator\/adjudications\/data-issues\/([0-9a-fA-F-]{36})\/defer$/);
    if(deferMatch){
      if(method!=='POST'){
        res.setHeader('allow','POST');
        return send(res,405,{error:'method_not_allowed'});
      }

      const auth=operatorAuthOrSend(req,res,['approver','admin']);
      if(!auth) return;

      const idempotencyKey=normalizeIdempotencyKey(req);
      if(!idempotencyKey){
        return send(res,400,{error:'idempotency_key_required'});
      }

      const body=await readJsonBody(req);
      const rationale=typeof body.rationale==='string' ? body.rationale.trim() : '';
      const expectedStatus=typeof body.expectedStatus==='string' ? body.expectedStatus.trim() : '';
      const evidence=body.evidence && typeof body.evidence==='object' && !Array.isArray(body.evidence)
        ? body.evidence
        : {};

      if(rationale.length<10 || rationale.length>2000){
        return send(res,400,{error:'adjudication_rationale_required'});
      }

      if(!['open','reviewing'].includes(expectedStatus)){
        return send(res,400,{error:'expected_status_required'});
      }

      const result=await deferDataIssue({
        issueId:deferMatch[1],
        actor:auth.actor,
        idempotencyKey,
        rationale,
        evidence,
        expectedStatus,
        req
      });
      return send(res,result.status,result.payload);
    }

    const rejectMatch=url.pathname.match(/^\/api\/v1\/operator\/adjudications\/data-issues\/([0-9a-fA-F-]{36})\/reject$/);
    if(rejectMatch){
      if(method!=='POST'){
        res.setHeader('allow','POST');
        return send(res,405,{error:'method_not_allowed'});
      }

      const auth=operatorAuthOrSend(req,res,['approver','admin']);
      if(!auth) return;

      const idempotencyKey=normalizeIdempotencyKey(req);
      if(!idempotencyKey) return send(res,400,{error:'idempotency_key_required'});

      const body=await readJsonBody(req);
      const rationale=typeof body.rationale==='string' ? body.rationale.trim() : '';
      const expectedStatus=typeof body.expectedStatus==='string' ? body.expectedStatus.trim() : '';
      const evidence=body.evidence && typeof body.evidence==='object' && !Array.isArray(body.evidence)
        ? body.evidence
        : {};

      if(rationale.length<10 || rationale.length>2000){
        return send(res,400,{error:'adjudication_rationale_required'});
      }
      if(!['open','reviewing','deferred'].includes(expectedStatus)){
        return send(res,400,{error:'expected_status_required'});
      }
      if(Object.keys(evidence).length===0){
        return send(res,400,{error:'adjudication_evidence_required'});
      }

      const result=await rejectDataIssue({
        issueId:rejectMatch[1],
        actor:auth.actor,
        idempotencyKey,
        rationale,
        evidence,
        expectedStatus,
        req
      });
      return send(res,result.status,result.payload);
    }

    const reopenMatch=url.pathname.match(/^\/api\/v1\/operator\/adjudications\/data-issues\/([0-9a-fA-F-]{36})\/reopen$/);
    if(reopenMatch){
      if(method!=='POST'){
        res.setHeader('allow','POST');
        return send(res,405,{error:'method_not_allowed'});
      }

      const auth=operatorAuthOrSend(req,res,['approver','admin']);
      if(!auth) return;

      const idempotencyKey=normalizeIdempotencyKey(req);
      if(!idempotencyKey) return send(res,400,{error:'idempotency_key_required'});

      const body=await readJsonBody(req);
      const rationale=typeof body.rationale==='string' ? body.rationale.trim() : '';
      const expectedStatus=typeof body.expectedStatus==='string' ? body.expectedStatus.trim() : '';
      const priorAuditEventId=typeof body.priorAuditEventId==='string' ? body.priorAuditEventId.trim() : '';
      const evidence=body.evidence && typeof body.evidence==='object' && !Array.isArray(body.evidence)
        ? body.evidence
        : {};

      if(rationale.length<10 || rationale.length>2000){
        return send(res,400,{error:'adjudication_rationale_required'});
      }
      if(!['deferred','rejected'].includes(expectedStatus)){
        return send(res,400,{error:'expected_status_required'});
      }
      if(!/^[0-9a-fA-F-]{36}$/.test(priorAuditEventId)){
        return send(res,400,{error:'prior_audit_event_required'});
      }

      const result=await reopenDataIssue({
        issueId:reopenMatch[1],
        actor:auth.actor,
        idempotencyKey,
        rationale,
        evidence,
        expectedStatus,
        priorAuditEventId,
        req
      });
      return send(res,result.status,result.payload);
    }

    if(url.pathname.startsWith('/api/v1/operator/adjudications/')){
      if(method!=='POST'){
        res.setHeader('allow','POST');
        return send(res,405,{error:'method_not_allowed'});
      }

      const auth=operatorAuthOrSend(req,res,['approver','admin']);
      if(!auth) return;

      return send(res,501,{
        error:'adjudication_not_enabled',
        mutationEnabled:false,
        actor:{subject:auth.actor.subject,roles:auth.actor.roles}
      });
    }

    if(!['GET','HEAD'].includes(method)){
      res.setHeader('allow','GET, HEAD');
      return send(res,405,{error:'method_not_allowed'});
    }

    const getProposalMatch=url.pathname.match(/^\/api\/v1\/operator\/proposals\/([0-9a-fA-F-]{36})$/);
    if(getProposalMatch){
      const auth=operatorAuthOrSend(req,res,['reviewer','approver','admin']);
      if(!auth) return;
      const capabilities=operatorAuthCapabilities();
      if(!capabilities.adjudication.dualControlEnabled){
        return send(res,503,{error:'dual_control_disabled',mutationEnabled:false});
      }
      if(!pool) return send(res,503,{error:'database_not_configured'});
      const proposal=await getDecisionProposal(pool,getProposalMatch[1]);
      return proposal
        ? send(res,200,{proposal})
        : send(res,404,{error:'decision_proposal_not_found'});
    }

    if(url.pathname==='/health'){
      if(!pool) return send(res,503,{ok:false,service:'transport-api',mode:'unconfigured'});
      await pool.query('select 1');
      return send(res,200,{ok:true,service:'transport-api',mode:'postgis'});
    }

    if(url.pathname==='/api/v1/operator/me'){
      const auth=operatorAuthOrSend(req,res,['reviewer','approver','admin']);
      if(!auth) return;
      const capabilities=operatorAuthCapabilities();
      return send(res,200,{
        actor:auth.actor,
        auth:capabilities,
        mutationEnabled:capabilities.mutationEnabled
      });
    }

    if(url.pathname==='/api/v1/operator/workbench'){
      if(method!=='GET' && method!=='HEAD'){
        res.setHeader('allow','GET, HEAD');
        return send(res,405,{error:'method_not_allowed'});
      }
      if(!pool) return send(res,503,{error:'database_not_configured'});
      const auth=operatorAuthOrSend(req,res,['reviewer','approver','admin']);
      if(!auth) return;
      const capabilities=operatorAuthCapabilities();
      if(!(await operatorWorkbenchSchemaAvailable(pool))){
        return send(res,503,{
          error:'operator_workbench_schema_unavailable',
          mutationEnabled:false,
          capabilities:capabilities.adjudication
        });
      }
      const rawLimit=Number(url.searchParams.get('limit') || 100);
      const workbench=await loadOperatorWorkbench(pool,{
        capabilities,
        limit:rawLimit
      });
      return send(res,200,{
        actor:{
          subject:auth.actor.subject,
          displayName:auth.actor.displayName,
          roles:auth.actor.roles
        },
        ...workbench
      });
    }

    if(url.pathname==='/api/v1/operator/quality-queue'){
      if(!pool) return send(res,503,{error:'database_not_configured'});
      const auth=operatorAuthOrSend(req,res,['reviewer','approver','admin']);
      if(!auth) return;
      const queue=await postgisOperatorQualityQueue(url);
      return send(res,200,{
        actor:{subject:auth.actor.subject,roles:auth.actor.roles},
        ...queue,
        mutationEnabled:operatorAuthCapabilities().mutationEnabled
      });
    }

    if(url.pathname==='/api/v1/meta'){
      if(!pool) return send(res,503,{error:'database_not_configured'});
      return send(res,200,await meta());
    }

    if(url.pathname==='/api/v1/ranks'){
      if(!pool) return send(res,503,{error:'database_not_configured'});
      return send(res,200,await postgisRanks(url));
    }

    if(url.pathname==='/api/v1/rank-filters'){
      if(!pool) return send(res,503,{error:'database_not_configured'});
      return send(res,200,await postgisRankFilters(url));
    }

    if(url.pathname==='/api/v1/coverage'){
      if(!pool) return send(res,503,{error:'database_not_configured'});
      return send(res,200,await postgisCoverage(url));
    }

    if(url.pathname==='/api/v1/coverage/national'){
      if(!pool) return send(res,503,{error:'database_not_configured'});
      const province=url.searchParams.get('province');
      return send(res,200,await loadNationalCoverageModel(pool,{province}));
    }

    if(url.pathname==='/api/v1/coverage/gaps'){
      if(!pool) return send(res,503,{error:'database_not_configured'});
      const province=url.searchParams.get('province');
      const municipality=url.searchParams.get('municipality');
      return send(res,200,await loadCoverageGapFeatures(pool,{province,municipality}));
    }

    if(url.pathname==='/api/v1/coverage/kzn/execution'){
      if(!pool) return send(res,503,{error:'database_not_configured'});
      return send(res,200,await loadKznCoverageExecution(pool));
    }

    if(url.pathname==='/api/v1/associations/map'){
      if(!pool) return send(res,503,{error:'database_not_configured'});
      return send(res,200,await postgisAssociationMap(url));
    }

    if(/^\/api\/v1\/associations\/[^/]+$/.test(url.pathname)){
      if(!pool) return send(res,503,{error:'database_not_configured'});
      const id=decodeURIComponent(url.pathname.split('/').pop());
      const association=await postgisAssociationDetail(id);
      return association ? send(res,200,association) : send(res,404,{error:'association_not_found'});
    }

    if(url.pathname==='/api/v1/data-quality/summary'){
      if(!pool) return send(res,503,{error:'database_not_configured'});
      return send(res,200,await postgisDataQualitySummary());
    }

    if(url.pathname==='/api/v1/network-inventory'){
      if(!pool) return send(res,503,{error:'database_not_configured'});
      return send(res,200,await postgisNetworkInventory());
    }

    if(url.pathname==='/api/v1/source-route-geometries'){
      if(!pool) return send(res,503,{error:'database_not_configured'});
      return send(res,200,await postgisSourceRouteGeometries(url));
    }

    if(url.pathname==='/api/v1/route-candidates/association-evidence'){
      if(!pool) return send(res,503,{error:'database_not_configured'});
      return send(res,200,await postgisRouteCandidateAssociationEvidence(url));
    }

    if(url.pathname==='/api/v1/route-candidates'){
      if(!pool) return send(res,503,{error:'database_not_configured'});
      return send(res,200,await postgisRouteCandidates(url));
    }

    if(url.pathname==='/api/v1/routes'){
      if(!pool) return send(res,503,{error:'database_not_configured'});
      return send(res,200,await postgisRoutes(url));
    }

    if(url.pathname==='/api/v1/nltis/endpoint-evidence'){
      if(!pool) return send(res,503,{error:'database_not_configured'});
      return send(res,200,await postgisNltisEndpointEvidence(url));
    }

    if(url.pathname==='/api/v1/associations'){
      if(!pool) return send(res,503,{error:'database_not_configured'});
      return send(res,200,await postgisAssociations(url));
    }

    if(url.pathname==='/api/v1/data-issues'){
      if(!pool) return send(res,503,{error:'database_not_configured'});
      const auth=operatorAuthOrSend(req,res,['reviewer','approver','admin']);
      if(!auth) return;
      return send(res,200,await postgisDataIssues(url));
    }

    if(url.pathname==='/api/v1/reconciliation/rank-candidates'){
      if(!pool) return send(res,503,{error:'database_not_configured'});
      const auth=operatorAuthOrSend(req,res,['reviewer','approver','admin']);
      if(!auth) return;
      return send(res,200,await postgisRankReconciliation(url));
    }

    if(url.pathname.startsWith('/api/v1/ranks/')){
      if(!pool) return send(res,503,{error:'database_not_configured'});
      const id=decodeURIComponent(url.pathname.split('/').pop());
      const rank=await rankDetail(id);
      return rank ? send(res,200,rank) : send(res,404,{error:'rank_not_found'});
    }

    return send(res,404,{error:'not_found'});
  }catch(error){
    console.error(error);
    return send(res,500,{error:'internal_error'});
  }
});

server.listen(port,'0.0.0.0',()=>console.log(`transport-api listening on :${port} (${pool?'postgis':'unconfigured'} mode)`));

process.on('SIGTERM',async()=>{
  if(pool) await pool.end();
  server.close();
});
