import { readFile } from 'node:fs/promises';

const evidence=JSON.parse(
  await readFile(new URL('./tn7-national-26-control-point-road-acquisition.json',import.meta.url),'utf8')
);

async function gluckstadtCollisionContext(db){
  const result=await db.query(
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
  );
  return {exactIdentityMatches:result.rows};
}

async function mbazwanaCanonicalState(db){
  const rank=await db.query(
    'SELECT id::text,canonical_name,aliases,province,verification_status::text FROM taxi_rank WHERE id=$1::uuid',
    [evidence.mbazwana.canonicalRankId]
  );
  const association=await db.query(
    'SELECT id::text,canonical_name,province,verification_status::text FROM taxi_association WHERE id=$1::uuid',
    [evidence.mbazwana.associationId]
  );
  const relationship=await db.query(
    'SELECT relationship_id::text,taxi_rank_id::text,association_id::text,verification_status::text FROM taxi_rank_association WHERE relationship_id=$1::uuid',
    [evidence.mbazwana.relationshipId]
  );
  return {
    rank:rank.rows[0]||null,
    association:association.rows[0]||null,
    relationship:relationship.rows[0]||null
  };
}

export async function buildNational26AcquisitionPlan(db){
  if(!db) return null;

  const collision=await gluckstadtCollisionContext(db);
  const canonicalState=await mbazwanaCanonicalState(db);
  const relationshipReady=Boolean(canonicalState.rank && canonicalState.association && canonicalState.relationship);

  const roadFeatureRequests=evidence.mbazwana.requiredRoads.map(roadNumber=>({
    roadNumber,
    serviceItemId:evidence.mbazwana.alternateAcquisition.serviceItemId,
    layerId:evidence.mbazwana.alternateAcquisition.layerId,
    matchField:evidence.mbazwana.alternateAcquisition.roadNumberField,
    outFields:evidence.mbazwana.alternateAcquisition.fields,
    outSpatialReference:evidence.mbazwana.alternateAcquisition.targetOutSpatialReference,
    acquired:false,
    geometryVerified:false
  }));

  return {
    mode:'tn7_national_26_gluckstadt_control_point_mbazwana_road_acquisition',
    gate:'TN7-NATIONAL-26',
    province:'KwaZulu-Natal',
    summary:{
      gluckstadtControlAreaEvidenceSources:evidence.gluckstadt.controlAreaBasis.length,
      gluckstadtControlAreaRecovered:evidence.gluckstadt.controlAreaRecovered,
      gluckstadtExactControlPointRecovered:evidence.gluckstadt.controlPointRecovered,
      gluckstadtIdentityCollisions:collision.exactIdentityMatches.length,
      mbazwanaCanonicalRelationshipReady:relationshipReady,
      mbazwanaRequiredRoads:evidence.mbazwana.requiredRoads.length,
      mbazwanaVerifiedRoadGeometries:0
    },
    policy:{
      ...evidence.policy,
      externalFetchPerformed:false,
      acquisitionRequestsDeclarativeOnly:true
    },
    gluckstadt:{
      ...evidence.gluckstadt,
      collision,
      featureRequest:{
        serviceItemId:evidence.gluckstadt.officialFeatureService.serviceItemId,
        layerId:evidence.gluckstadt.officialFeatureService.layerId,
        matchField:evidence.gluckstadt.officialFeatureService.rankCodeField,
        targetOutSpatialReference:evidence.gluckstadt.officialFeatureService.targetOutSpatialReference
      },
      nextAction:'execute_authoritative_point_feature_query_and_reconcile',
      automaticRankCreation:false,
      canonicalMutation:false
    },
    mbazwana:{
      ...evidence.mbazwana,
      canonicalState,
      roadFeatureRequests,
      nextAction:'execute_authoritative_road_feature_queries_and_validate_topology',
      automaticRouteCandidateCreation:false,
      canonicalMutation:false
    }
  };
}
