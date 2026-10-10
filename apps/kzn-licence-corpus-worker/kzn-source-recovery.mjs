import { readFile } from 'node:fs/promises';

const recoveryEvidence=JSON.parse(
  await readFile(new URL('./tn7-national-20-source-recovery.json',import.meta.url),'utf8')
);

function normalize(value=''){
  return String(value).normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]+/g,'').trim();
}

function phraseSupportsCandidate(mention,candidate){
  const text=String(mention||'').normalize('NFKC').toUpperCase();
  const location=String(candidate.canonicalNameCandidate||'')
    .replace(/\bTAXI\s+RANK\b/ig,'')
    .trim()
    .toUpperCase();
  return Boolean(location) &&
    text.includes(location) &&
    /TAXI\s+RANK/.test(text);
}

async function rankCollisionState(db,candidate){
  const exact=(await db.query(
    `SELECT id::text,canonical_name,aliases,province,municipality,town,verification_status::text
       FROM taxi_rank
       WHERE province='KwaZulu-Natal'
         AND normalize_transport_identity_name(canonical_name)=normalize_transport_identity_name($1)
       ORDER BY id`,
    [candidate.canonicalNameCandidate]
  )).rows;

  let nearby=[];
  if(Number.isFinite(candidate.latitude) && Number.isFinite(candidate.longitude)){
    nearby=(await db.query(
      `SELECT id::text,canonical_name,
              round(ST_DistanceSphere(location,ST_SetSRID(ST_MakePoint($1,$2),4326))::numeric,1) AS distance_m
         FROM taxi_rank
         WHERE province='KwaZulu-Natal'
           AND location IS NOT NULL
           AND ST_DWithin(
             location::geography,
             ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,
             150
           )
         ORDER BY distance_m,id`,
      [candidate.longitude,candidate.latitude]
    )).rows;
  }

  return {
    exactCanonicalNameMatches:exact,
    nearbyCollisionReview:nearby,
    duplicateSafe:exact.length===0 && nearby.length===0
  };
}

export async function buildNational20SourceRecoveryPlan(db,targetRecovery){
  if(!db || !targetRecovery) return null;

  const observedRoutes=new Map();
  for(const item of targetRecovery.routeRecovery?.items||[]){
    if(item.routeCode) observedRoutes.set(normalize(item.routeCode),item);
  }

  const routeRecoveries=[];
  const routeUnresolved=[];

  for(const row of recoveryEvidence.routeIdentityRecoveries||[]){
    const source=observedRoutes.get(normalize(row.observedRouteCode))||null;
    if(!source) continue;
    routeRecoveries.push({
      ...row,
      evidenceId:source.evidenceId||null,
      association:source.association||null,
      state:'documentary_route_identity_recovered',
      nextAction:'source_geometry_recovery_required',
      routeCandidateCreationReady:false,
      automaticCandidateCreation:false,
      canonicalMutation:false
    });
  }

  for(const row of recoveryEvidence.unresolvedRouteIdentities||[]){
    const source=observedRoutes.get(normalize(row.observedRouteCode))||null;
    if(!source) continue;
    routeUnresolved.push({
      ...row,
      evidenceId:source.evidenceId||null,
      association:source.association||null,
      state:'route_identity_source_gap',
      nextAction:'additional_authoritative_route_source_required',
      automaticCandidateCreation:false,
      canonicalMutation:false
    });
  }

  const rankItems=targetRecovery.rankRecovery?.items||[];
  const rankCandidates=[];

  for(const candidate of recoveryEvidence.missingRankSourceCandidates||[]){
    const supporting=rankItems.filter(item=>
      item.association?.name===candidate.associationLabel &&
      phraseSupportsCandidate(item.mention,candidate)
    );
    const collision=await rankCollisionState(db,candidate);
    const uniqueEvidenceIds=[...new Set(supporting.map(x=>x.evidenceId))];

    let state='documented_missing_rank_source_candidate';
    let nextAction='controlled_rank_creation_review_required';

    if(candidate.locationStatus==='location_pending'){
      state='documented_missing_rank_location_pending';
      nextAction='rank_location_source_recovery_required';
    }
    if(!collision.duplicateSafe){
      state='rank_candidate_collision_review_required';
      nextAction='manual_rank_collision_review';
    }

    rankCandidates.push({
      ...candidate,
      supportingEvidenceRows:uniqueEvidenceIds.length,
      supportingEvidenceIds:uniqueEvidenceIds,
      collision,
      state,
      nextAction,
      automaticCanonicalCreation:false,
      automaticAliasCreation:false,
      canonicalMutation:false
    });
  }

  const missingRouteCodes=[...new Set(
    (targetRecovery.routeRecovery?.items||[])
      .map(x=>x.routeCode)
      .filter(Boolean)
      .map(normalize)
  )];
  const recoveredCodes=new Set(routeRecoveries.map(x=>normalize(x.observedRouteCode)));

  return {
    mode:'tn7_national_20_kzn_source_recovery',
    gate:'TN7-NATIONAL-20',
    province:'KwaZulu-Natal',
    summary:{
      unresolvedRouteIdentifiers:missingRouteCodes.length,
      documentaryRouteIdentitiesRecovered:recoveredCodes.size,
      routeIdentitiesStillUnresolved:missingRouteCodes.filter(code=>!recoveredCodes.has(code)).length,
      routeGeometriesRecovered:0,
      routeCandidatesCreationReady:0,
      missingRankSourceCandidates:rankCandidates.length,
      rankCandidatesWithDocumentedCoordinates:rankCandidates.filter(x=>x.locationStatus==='documented_source_coordinate').length,
      rankCandidatesLocationPending:rankCandidates.filter(x=>x.locationStatus==='location_pending').length,
      rankCandidatesCollisionReview:rankCandidates.filter(x=>!x.collision.duplicateSafe).length
    },
    sourceDiagnostics:{
      officialRouteGisFeatureCount:2024,
      officialRouteGisExactMatchesForUnresolved:0,
      officialRouteGisBoundedPrefixMatchesForUnresolved:0,
      officialRankGisFeatureCount:603,
      officialRankGisDescriptiveNameField:false
    },
    policy:{
      documentarySourceRecoveryOnly:true,
      geometryInvented:false,
      coordinatesInvented:false,
      fuzzyMatching:false,
      geographicProximityIdentityMatching:false,
      nearbyCoordinatesUsedForCollisionReviewOnly:true,
      automaticRouteCandidateCreation:false,
      automaticRankCreation:false,
      automaticProposalCreation:false,
      automaticApproval:false,
      canonicalMutation:false
    },
    routeRecoveries,
    routeUnresolved,
    rankCandidates
  };
}
