import { createHash } from 'node:crypto';
import { loadKznBhamshelaIdentityResolution } from './kzn-bhamshela-identity.mjs';
import { loadKznGazetteEvidenceQueue } from './kzn-gazette-queue.mjs';
import { recoverRouteEvidenceGaps } from './route-evidence-gap-recovery.mjs';
import {
  buildRankAssociationSnapshot,
  validateRankAssociationSnapshot
} from './operator-association-links.mjs';
import {
  loadRouteCandidatePromotionSnapshot,
  validateRoutePromotionSnapshot
} from './operator-routes.mjs';
import {
  createTaxiAssociationCreateProposal,
  createAliasProposal,
  createRankAssociationAssignmentProposal,
  createRoutePromotionProposal
} from './operator-proposals.mjs';

const TARGET_ROUTES=['KZNBRCPMB100','KZNBRCPMB102','KZNBRCPMB103'];

function childKey(batchKey,...parts){
  return createHash('sha256').update([batchKey,...parts].join(':')).digest('hex').slice(0,48);
}

async function viableRankAssociationCandidates(pool,rankId,associationId){
  const result=await pool.query(
    'SELECT id::text FROM rank_association_candidate WHERE taxi_rank_id=$1::uuid ORDER BY id',
    [rankId]
  );
  const viable=[];
  const rejected=[];
  for(const row of result.rows){
    const snapshot=await buildRankAssociationSnapshot(pool,{candidateId:row.id,associationId,lock:false});
    const validation=validateRankAssociationSnapshot(snapshot);
    if(validation.ok) viable.push({candidateId:row.id,rankId});
    else rejected.push({candidateId:row.id,error:validation.error});
  }
  return {viable,rejected};
}

async function assessRoute(pool,item,association){
  const candidates=item.routeCandidates||[];
  if(candidates.length===0){
    const recovery=await recoverRouteEvidenceGaps(pool,{
      province:'KwaZulu-Natal',
      evidenceRows:[{
        routeCode:item.routeCode,
        association:item.association,
        rankNarrative:item.rankNarrative,
        source:item.source,
        sourceUrl:item.sourceUrl,
        evidenceOrigin:item.evidenceOrigin
      }],
      limit:1
    });
    return {
      routeCode:item.routeCode,
      state:'route_candidate_gap',
      reason:'no_exact_route_candidate',
      recovery:recovery?.items?.[0]||null,
      automaticMutation:false
    };
  }

  if(candidates.length>1){
    return {
      routeCode:item.routeCode,
      state:'blocked',
      reason:'multiple_route_candidate_code_matches',
      candidateIds:candidates.map(x=>x.id),
      automaticMutation:false
    };
  }

  const candidate=candidates[0];
  const snapshot=await loadRouteCandidatePromotionSnapshot(pool,{
    candidateId:candidate.id,
    associationId:association.id,
    lock:false
  });
  const validation=validateRoutePromotionSnapshot(snapshot,association.id);

  if(validation.ok){
    return {
      routeCode:item.routeCode,
      state:'adj6_proposal_ready',
      association,
      routeCandidate:candidate,
      requiredProposals:[{
        action:'taxi_route.promote',
        candidateId:candidate.id,
        associationId:association.id
      }],
      automaticMutation:false
    };
  }

  if(!['route_candidate_association_not_shared_by_endpoints','route_candidate_endpoint_association_conflict'].includes(validation.error)){
    return {
      routeCode:item.routeCode,
      state:'blocked',
      reason:validation.error,
      validation,
      automaticMutation:false
    };
  }

  const existing=new Set((snapshot.endpointRelationships||[])
    .filter(rel=>rel.associationId===association.id)
    .map(rel=>rel.taxiRankId));
  const endpoints=[
    {role:'origin',rankId:snapshot.candidate.originRankId},
    {role:'destination',rankId:snapshot.candidate.destinationRankId}
  ];
  const missing=endpoints.filter(x=>!existing.has(x.rankId));
  const prerequisites=[];
  const blocks=[];

  for(const endpoint of missing){
    const evidence=await viableRankAssociationCandidates(pool,endpoint.rankId,association.id);
    if(evidence.viable.length===1){
      prerequisites.push({
        action:'taxi_rank_association.assign',
        endpoint:endpoint.role,
        rankId:endpoint.rankId,
        candidateId:evidence.viable[0].candidateId,
        associationId:association.id
      });
    }else{
      blocks.push({
        endpoint:endpoint.role,
        rankId:endpoint.rankId,
        reason:evidence.viable.length===0
          ? 'no_viable_rank_association_candidate'
          : 'multiple_viable_rank_association_candidates',
        viableCandidateIds:evidence.viable.map(x=>x.candidateId),
        rejected:evidence.rejected
      });
    }
  }

  if(blocks.length){
    return {
      routeCode:item.routeCode,
      state:'blocked',
      reason:'adj5_prerequisite_evidence_incomplete',
      blocks,
      automaticMutation:false
    };
  }

  return {
    routeCode:item.routeCode,
    state:'adj5_prerequisites_ready',
    association,
    routeCandidate:candidate,
    requiredProposals:prerequisites,
    followUp:{
      action:'taxi_route.promote',
      candidateId:candidate.id,
      associationId:association.id,
      condition:'after_all_ADJ5_prerequisites_are_independently_approved'
    },
    automaticMutation:false
  };
}

export async function loadKznBhamshelaCanonicalisationPlan(pool){
  if(!pool) return null;
  const identity=await loadKznBhamshelaIdentityResolution(pool);
  const queue=await loadKznGazetteEvidenceQueue(pool,{limit:250});
  const routeItems=(queue?.queue?.items||[]).filter(item=>TARGET_ROUTES.includes(item.routeCode));

  const base={
    mode:'tn7_national_7_bhamshela_controlled_canonicalisation',
    gate:'TN7-NATIONAL-7',
    province:'KwaZulu-Natal',
    targetRoutes:TARGET_ROUTES,
    identity,
    policy:{
      automaticApproval:false,
      automaticCanonicalCreation:false,
      automaticAliasPromotion:false,
      automaticRelationshipAssignment:false,
      automaticRoutePromotion:false,
      twoPersonControlRequired:true
    }
  };

  if(identity.status==='canonical_identity_evidence_ready'){
    return {
      ...base,
      stage:'association_creation_proposal_required',
      nextAction:{
        action:'taxi_association.create',
        canonicalName:identity.requestedIdentity.label,
        province:identity.requestedIdentity.province,
        district:identity.requestedIdentity.region,
        verificationStatus:'documented',
        evidencePack:identity.supportingEvidence
      },
      routes:routeItems.map(item=>({
        routeCode:item.routeCode,
        state:'waiting_for_canonical_association',
        currentBucket:item.bucket
      }))
    };
  }

  if(identity.status==='canonical_identity_variant_review' && identity.canonicalAssociation){
    return {
      ...base,
      stage:'association_alias_proposal_required',
      nextAction:{
        action:'taxi_association.alias.add',
        associationId:identity.canonicalAssociation.id,
        alias:identity.requestedIdentity.label,
        evidencePack:identity.supportingEvidence
      },
      routes:routeItems.map(item=>({
        routeCode:item.routeCode,
        state:'waiting_for_identity_alias_review',
        currentBucket:item.bucket
      }))
    };
  }

  if(identity.status!=='canonical_identity_resolved_exact' || !identity.canonicalAssociation){
    return {
      ...base,
      stage:'identity_blocked',
      reason:identity.reason,
      routes:routeItems.map(item=>({
        routeCode:item.routeCode,
        state:'blocked_by_association_identity',
        currentBucket:item.bucket
      }))
    };
  }

  const routes=[];
  for(const item of routeItems){
    routes.push(await assessRoute(pool,item,identity.canonicalAssociation));
  }

  return {
    ...base,
    stage:'route_unlock_planning',
    canonicalAssociation:identity.canonicalAssociation,
    routes,
    counts:routes.reduce((acc,row)=>{
      acc[row.state]=(acc[row.state]||0)+1;
      return acc;
    },{})
  };
}

export async function createKznBhamshelaNextProposals(pool,{
  actor,
  batchIdempotencyKey,
  rationale,
  evidence={},
  requestId
}){
  const plan=await loadKznBhamshelaCanonicalisationPlan(pool);

  if(plan.stage==='association_creation_proposal_required'){
    const spec=plan.nextAction;
    const result=await createTaxiAssociationCreateProposal(pool,{
      canonicalName:spec.canonicalName,
      province:spec.province,
      district:spec.district,
      verificationStatus:spec.verificationStatus,
      actor,
      idempotencyKey:childKey(batchIdempotencyKey,'association-create',spec.canonicalName),
      rationale,
      evidence:{
        ...evidence,
        gate:'TN7-NATIONAL-7',
        sourceGate:'TN7-NATIONAL-6',
        officialIdentityEvidence:spec.evidencePack
      },
      requestId
    });
    return {
      mode:'tn7_national_7_proposal_execution',
      stage:plan.stage,
      automaticApproval:false,
      canonicalMutationPerformed:false,
      result:{action:'taxi_association.create',status:result.status,payload:result.payload}
    };
  }

  if(plan.stage==='association_alias_proposal_required'){
    const spec=plan.nextAction;
    const result=await createAliasProposal(pool,{
      entityType:'taxi_association',
      entityId:spec.associationId,
      alias:spec.alias,
      actor,
      idempotencyKey:childKey(batchIdempotencyKey,'association-alias',spec.associationId),
      rationale,
      evidence:{
        ...evidence,
        gate:'TN7-NATIONAL-7',
        sourceGate:'TN7-NATIONAL-6',
        officialIdentityEvidence:spec.evidencePack
      },
      requestId
    });
    return {
      mode:'tn7_national_7_proposal_execution',
      stage:plan.stage,
      automaticApproval:false,
      canonicalMutationPerformed:false,
      result:{action:'taxi_association.alias.add',status:result.status,payload:result.payload}
    };
  }

  if(plan.stage!=='route_unlock_planning'){
    return {
      mode:'tn7_national_7_proposal_execution',
      stage:plan.stage,
      automaticApproval:false,
      canonicalMutationPerformed:false,
      result:{status:409,error:'national7_plan_not_proposable',reason:plan.reason||null}
    };
  }

  const results=[];
  for(const route of plan.routes){
    if(route.state==='adj6_proposal_ready'){
      const spec=route.requiredProposals[0];
      const result=await createRoutePromotionProposal(pool,{
        candidateId:spec.candidateId,
        associationId:spec.associationId,
        actor,
        idempotencyKey:childKey(batchIdempotencyKey,route.routeCode,'adj6',spec.candidateId),
        rationale,
        evidence:{...evidence,gate:'TN7-NATIONAL-7',routeCode:route.routeCode},
        requestId
      });
      results.push({routeCode:route.routeCode,action:'taxi_route.promote',status:result.status,payload:result.payload});
      continue;
    }

    if(route.state==='adj5_prerequisites_ready'){
      for(const spec of route.requiredProposals){
        const result=await createRankAssociationAssignmentProposal(pool,{
          candidateId:spec.candidateId,
          associationId:spec.associationId,
          actor,
          idempotencyKey:childKey(batchIdempotencyKey,route.routeCode,'adj5',spec.endpoint,spec.candidateId),
          rationale,
          evidence:{...evidence,gate:'TN7-NATIONAL-7',routeCode:route.routeCode,endpoint:spec.endpoint},
          requestId
        });
        results.push({
          routeCode:route.routeCode,
          action:'taxi_rank_association.assign',
          endpoint:spec.endpoint,
          status:result.status,
          payload:result.payload
        });
      }
      continue;
    }

    results.push({
      routeCode:route.routeCode,
      action:null,
      status:409,
      state:route.state,
      reason:route.reason||null,
      recovery:route.recovery||null
    });
  }

  return {
    mode:'tn7_national_7_proposal_execution',
    stage:plan.stage,
    automaticApproval:false,
    canonicalMutationPerformed:false,
    results
  };
}
