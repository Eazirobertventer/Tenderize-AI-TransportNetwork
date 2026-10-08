import { createHash } from 'node:crypto';
import { loadKznGazetteEvidenceQueue } from './kzn-gazette-queue.mjs';
import {
  buildRankAssociationSnapshot,
  validateRankAssociationSnapshot
} from './operator-association-links.mjs';
import {
  loadRouteCandidatePromotionSnapshot,
  validateRoutePromotionSnapshot
} from './operator-routes.mjs';
import {
  createRankAssociationAssignmentProposal,
  createRoutePromotionProposal
} from './operator-proposals.mjs';

function childKey(batchKey,...parts){
  return createHash('sha256')
    .update([batchKey,...parts].join(':'))
    .digest('hex')
    .slice(0,48);
}

async function viableAssociationCandidate(pool,rankId,associationId){
  const candidates=await pool.query(
    `SELECT id::text
       FROM rank_association_candidate
       WHERE taxi_rank_id=$1::uuid
       ORDER BY id`,
    [rankId]
  );
  const viable=[];
  const rejected=[];
  for(const row of candidates.rows){
    const snapshot=await buildRankAssociationSnapshot(pool,{
      candidateId:row.id,
      associationId,
      lock:false
    });
    const validation=validateRankAssociationSnapshot(snapshot);
    if(validation.ok) viable.push({candidateId:row.id,rankId});
    else rejected.push({candidateId:row.id,error:validation.error});
  }
  return {viable,rejected};
}

export async function loadKznDeterministicAdjudicationBatch(pool,{limit=13}={}){
  if(!pool) return null;
  const queue=await loadKznGazetteEvidenceQueue(pool,{limit:250});
  const ready=(queue?.queue?.items||[])
    .filter(item=>item.bucket==='route_candidate_evidence_ready')
    .slice(0,Math.min(Math.max(Number(limit)||13,1),13));

  const items=[];
  for(const item of ready){
    const association=item.associationMatches?.[0]||null;
    const candidate=item.routeCandidates?.[0]||null;
    if(!association || !candidate){
      items.push({
        routeCode:item.routeCode,
        state:'blocked',
        reason:'deterministic_queue_identity_missing',
        automaticApproval:false
      });
      continue;
    }

    const routeSnapshot=await loadRouteCandidatePromotionSnapshot(pool,{
      candidateId:candidate.id,
      associationId:association.id,
      lock:false
    });
    const routeValidation=validateRoutePromotionSnapshot(routeSnapshot,association.id);

    if(routeValidation.ok){
      items.push({
        routeCode:item.routeCode,
        association,
        routeCandidate:candidate,
        state:'adj6_proposal_ready',
        requiredProposals:[{
          action:'taxi_route.promote',
          candidateId:candidate.id,
          associationId:association.id
        }],
        automaticApproval:false,
        evidenceOrigin:item.evidenceOrigin
      });
      continue;
    }

    if(!['route_candidate_association_not_shared_by_endpoints','route_candidate_endpoint_association_conflict'].includes(routeValidation.error)){
      items.push({
        routeCode:item.routeCode,
        association,
        routeCandidate:candidate,
        state:'blocked',
        reason:routeValidation.error,
        validation:routeValidation,
        automaticApproval:false,
        evidenceOrigin:item.evidenceOrigin
      });
      continue;
    }

    const existing=new Set((routeSnapshot.endpointRelationships||[])
      .filter(rel=>rel.associationId===association.id)
      .map(rel=>rel.taxiRankId));
    const endpoints=[
      {role:'origin',rankId:routeSnapshot.candidate.originRankId},
      {role:'destination',rankId:routeSnapshot.candidate.destinationRankId}
    ];
    const missing=endpoints.filter(endpoint=>!existing.has(endpoint.rankId));
    const prerequisites=[];
    const blocks=[];

    for(const endpoint of missing){
      const evidence=await viableAssociationCandidate(pool,endpoint.rankId,association.id);
      if(evidence.viable.length===1){
        prerequisites.push({
          action:'taxi_rank_association.assign',
          endpoint: endpoint.role,
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
          viableCandidateIds:evidence.viable.map(v=>v.candidateId),
          rejected:evidence.rejected
        });
      }
    }

    if(blocks.length){
      items.push({
        routeCode:item.routeCode,
        association,
        routeCandidate:candidate,
        state:'blocked',
        reason:'adj5_prerequisite_evidence_incomplete',
        blocks,
        automaticApproval:false,
        evidenceOrigin:item.evidenceOrigin
      });
      continue;
    }

    items.push({
      routeCode:item.routeCode,
      association,
      routeCandidate:candidate,
      state:'adj5_prerequisites_ready',
      requiredProposals:prerequisites,
      followUp:{
        action:'taxi_route.promote',
        candidateId:candidate.id,
        associationId:association.id,
        condition:'only_after_all_ADJ5_prerequisites_are_independently_approved'
      },
      automaticApproval:false,
      evidenceOrigin:item.evidenceOrigin
    });
  }

  const counts=items.reduce((acc,item)=>{
    acc[item.state]=(acc[item.state]||0)+1;
    return acc;
  },{});

  return {
    mode:'tn7_national_4_kzn_deterministic_adjudication_batch',
    province:'KwaZulu-Natal',
    sourceQueue:'TN7-NATIONAL-3',
    maximumBatchSize:13,
    selected:items.length,
    policy:{
      deterministicQueueOnly:true,
      automaticApproval:false,
      twoPersonControlRequired:true,
      createCanonicalDataDirectly:false,
      adj5BeforeAdj6WhenEndpointAssociationMissing:true
    },
    counts,
    items
  };
}

export async function createKznDeterministicProposalBatch(pool,{
  actor,
  batchIdempotencyKey,
  rationale,
  evidence={},
  limit=13,
  requestId
}){
  const plan=await loadKznDeterministicAdjudicationBatch(pool,{limit});
  const results=[];

  for(const item of plan.items){
    if(item.state==='blocked'){
      results.push({routeCode:item.routeCode,state:'blocked',reason:item.reason});
      continue;
    }

    if(item.state==='adj6_proposal_ready'){
      const spec=item.requiredProposals[0];
      const result=await createRoutePromotionProposal(pool,{
        candidateId:spec.candidateId,
        associationId:spec.associationId,
        actor,
        idempotencyKey:childKey(batchIdempotencyKey,item.routeCode,'adj6',spec.candidateId),
        rationale,
        evidence:{
          ...evidence,
          gate:'TN7-NATIONAL-4',
          routeCode:item.routeCode,
          evidenceOrigin:item.evidenceOrigin,
          sourceQueue:'TN7-NATIONAL-3'
        },
        requestId
      });
      results.push({
        routeCode:item.routeCode,
        state:result.status<300?'proposal_created':'proposal_not_created',
        action:'taxi_route.promote',
        status:result.status,
        payload:result.payload
      });
      continue;
    }

    const proposals=[];
    for(const spec of item.requiredProposals||[]){
      const result=await createRankAssociationAssignmentProposal(pool,{
        candidateId:spec.candidateId,
        associationId:spec.associationId,
        actor,
        idempotencyKey:childKey(batchIdempotencyKey,item.routeCode,'adj5',spec.endpoint,spec.candidateId),
        rationale,
        evidence:{
          ...evidence,
          gate:'TN7-NATIONAL-4',
          routeCode:item.routeCode,
          endpoint:spec.endpoint,
          evidenceOrigin:item.evidenceOrigin,
          sourceQueue:'TN7-NATIONAL-3'
        },
        requestId
      });
      proposals.push({
        endpoint:spec.endpoint,
        action:'taxi_rank_association.assign',
        status:result.status,
        payload:result.payload
      });
    }
    results.push({
      routeCode:item.routeCode,
      state:proposals.every(p=>p.status<300)?'prerequisite_proposals_created':'prerequisite_proposal_incomplete',
      proposals,
      followUp:item.followUp
    });
  }

  return {
    mode:'tn7_national_4_proposal_batch',
    automaticApproval:false,
    canonicalMutationPerformed:false,
    selected:plan.selected,
    results
  };
}
