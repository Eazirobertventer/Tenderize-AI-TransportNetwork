import { readFile } from 'node:fs/promises';

const evidence=JSON.parse(
  await readFile(new URL('./tn7-national-25-source-acquisition.json',import.meta.url),'utf8')
);

async function loadMbazwanaState(db){
  const [rank,association,relationship]=await Promise.all([
    db.query(
      `SELECT id::text,canonical_name,aliases,province,verification_status::text,
              CASE WHEN location IS NULL THEN NULL ELSE ST_Y(location) END AS latitude,
              CASE WHEN location IS NULL THEN NULL ELSE ST_X(location) END AS longitude
         FROM taxi_rank WHERE id=$1::uuid`,
      [evidence.mbazwana.canonicalRankId]
    ),
    db.query(
      `SELECT id::text,canonical_name,province,verification_status::text
         FROM taxi_association WHERE id=$1::uuid`,
      [evidence.mbazwana.associationId]
    ),
    db.query(
      `SELECT relationship_id::text,taxi_rank_id::text,association_id::text,
              verification_status::text,first_seen_at,last_seen_at
         FROM taxi_rank_association
         WHERE relationship_id=$1::uuid`,
      [evidence.mbazwana.relationshipId]
    )
  ]);
  return {
    rank:rank.rows[0]||null,
    association:association.rows[0]||null,
    relationship:relationship.rows[0]||null
  };
}

async function gluckstadtCollisionContext(db){
  const exact=(await db.query(
    `SELECT id::text,canonical_name,aliases,province,municipality,town,
            verification_status::text
       FROM taxi_rank
       WHERE province='KwaZulu-Natal'
         AND (
           normalize_transport_identity_name(canonical_name)=normalize_transport_identity_name($1)
           OR EXISTS (
             SELECT 1 FROM unnest(aliases) alias
             WHERE normalize_transport_identity_name(alias)=normalize_transport_identity_name($1)
           )
         )
       ORDER BY id`,
    [evidence.gluckstadt.canonicalNameCandidate]
  )).rows;

  return {exactIdentityMatches:exact};
}

export async function buildNational25SourceAcquisitionPlan(db){
  if(!db) return null;

  const mbazwana=await loadMbazwanaState(db);
  const gluckstadtCollision=await gluckstadtCollisionContext(db);

  const mbazwanaReady=Boolean(
    mbazwana.rank &&
    mbazwana.association &&
    mbazwana.relationship &&
    (mbazwana.rank.aliases||[]).includes(evidence.mbazwana.rankAlias)
  );

  const routeCases=evidence.mbazwana.documentaryRoutes.map(route=>({
    ...route,
    canonicalRankId:evidence.mbazwana.canonicalRankId,
    associationId:evidence.mbazwana.associationId,
    relationshipId:evidence.mbazwana.relationshipId,
    officialRoadNetwork:evidence.mbazwana.officialRoadNetwork,
    reconstructionState:
      evidence.mbazwana.officialRoadNetwork.verifiedTlsAcquisitionAvailable
        ? 'official_road_centerline_acquisition_ready'
        : 'official_road_centerline_source_delivery_blocked',
    routeCandidateCreationReady:false,
    automaticGeometryCreation:false,
    canonicalMutation:false
  }));

  const gluckstadt={
    ...evidence.gluckstadt,
    collision:gluckstadtCollision,
    state:evidence.gluckstadt.rankCoordinateRecovered
      ? 'rank_coordinate_recovered_review_required'
      : 'documented_rank_location_pending',
    nextAction:evidence.gluckstadt.rankCoordinateRecovered
      ? 'controlled_rank_source_candidate_review'
      : 'authoritative_rank_coordinate_acquisition_required',
    automaticRankCreation:false,
    canonicalMutation:false
  };

  return {
    mode:'tn7_national_25_mbz_route_reconstruction_gluckstadt_geospatial_acquisition',
    gate:'TN7-NATIONAL-25',
    province:'KwaZulu-Natal',
    summary:{
      mbazwanaCanonicalRelationshipReady:mbazwanaReady,
      mbazwanaDocumentaryRoutes:routeCases.length,
      mbazwanaRoadCenterlineAcquisitionReady:routeCases.filter(x=>x.reconstructionState==='official_road_centerline_acquisition_ready').length,
      mbazwanaRoadCenterlineSourceBlocked:routeCases.filter(x=>x.reconstructionState==='official_road_centerline_source_delivery_blocked').length,
      mbazwanaRouteCandidatesReady:0,
      gluckstadtExistenceEvidenceSources:evidence.gluckstadt.evidence.length,
      gluckstadtCoordinateRecovered:Boolean(evidence.gluckstadt.rankCoordinateRecovered),
      gluckstadtIdentityCollisions:gluckstadtCollision.exactIdentityMatches.length
    },
    policy:{
      sourceAcquisitionOnly:true,
      proseToGeometrySynthesis:false,
      geometryInvented:false,
      coordinatesInvented:false,
      automaticRankCreation:false,
      automaticRouteCandidateCreation:false,
      automaticProposalCreation:false,
      automaticApproval:false,
      canonicalMutation:false
    },
    mbazwana:{
      canonicalState:mbazwana,
      routeCases
    },
    gluckstadt
  };
}
