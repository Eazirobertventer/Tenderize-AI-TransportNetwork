import {
  buildRankAssociationSnapshot,
  validateRankAssociationSnapshot
} from '../transport-api/src/operator-association-links.mjs';
import {
  loadRouteCandidatePromotionSnapshot,
  validateRoutePromotionSnapshot
} from '../transport-api/src/operator-routes.mjs';

export const NATIONAL18_ASSOCIATION_NAMES=[
  'CHATSWORTH MINIBUS ASSOCIATION',
  'THUTHUKANI TAXI ASSOCIATION (HARDING)',
  'MIDLANDS TAXI ASSOCIATION',
  'MBAZWANA TAXI ASSOCIATION',
  'BAMBANANI TAXI ASSOCIATION(KZN)',
  'NGWELEZANE TAXI ASSOCIATION',
  'LINDELANI TAXI ASSOCIATION',
  'GLUCKSTADT TAXI OWNERS ASSOCIATION',
  'MLABA & MKHIZWANE TAXI ASSOCIATION'
];

async function viableRankCandidates(db,rankId,associationId){
  const rows=(await db.query(
    `SELECT id::text
       FROM rank_association_candidate
       WHERE taxi_rank_id=$1::uuid
       ORDER BY id`,
    [rankId]
  )).rows;

  const viable=[];
  const rejected=[];
  for(const row of rows){
    const snapshot=await buildRankAssociationSnapshot(db,{
      candidateId:row.id,
      associationId,
      lock:false
    });
    const validation=validateRankAssociationSnapshot(snapshot);
    if(validation.ok){
      viable.push({candidateId:row.id,rankId,associationId});
    }else{
      rejected.push({candidateId:row.id,error:validation.error});
    }
  }
  return {viable,rejected};
}

function dedupe(items,keyFn){
  const seen=new Set();
  return items.filter(item=>{
    const key=keyFn(item);
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function buildNational18UnlockPlan(db,queueItems=[]){
  if(!db) return null;
  const targetNames=new Set(NATIONAL18_ASSOCIATION_NAMES);
  const targetedRows=queueItems.filter(item=>
    item.associationMatches?.length===1 &&
    targetNames.has(item.associationMatches[0].name)
  );

  const rankUnlocks=[];
  const routeUnlocks=[];
  const blocked=[];

  for(const item of targetedRows){
    const association=item.associationMatches[0];

    if(item.routeCandidateMatches?.length===1){
      const candidate=item.routeCandidateMatches[0];
      const snapshot=await loadRouteCandidatePromotionSnapshot(db,{
        candidateId:candidate.id,
        associationId:association.id,
        lock:false
      });
      const validation=validateRoutePromotionSnapshot(snapshot,association.id);

      if(validation.ok){
        routeUnlocks.push({
          evidenceId:item.evidenceId,
          association,
          routeCode:candidate.route_code||item.routeIdentifiers?.[0]||null,
          candidateId:candidate.id,
          state:'adj6_proposal_ready',
          requiredProposals:[{
            action:'taxi_route.promote',
            candidateId:candidate.id,
            associationId:association.id
          }],
          automaticApproval:false
        });
        continue;
      }

      if(['route_candidate_association_not_shared_by_endpoints','route_candidate_endpoint_association_conflict'].includes(validation.error)){
        const existing=new Set((snapshot.endpointRelationships||[])
          .filter(rel=>rel.associationId===association.id)
          .map(rel=>rel.taxiRankId));
        const endpoints=[
          {role:'origin',rankId:snapshot.candidate.originRankId},
          {role:'destination',rankId:snapshot.candidate.destinationRankId}
        ];
        const missing=endpoints.filter(endpoint=>!existing.has(endpoint.rankId));
        const prerequisites=[];
        const blocks=[];

        for(const endpoint of missing){
          const evidence=await viableRankCandidates(db,endpoint.rankId,association.id);
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

        if(!blocks.length && prerequisites.length){
          routeUnlocks.push({
            evidenceId:item.evidenceId,
            association,
            routeCode:candidate.route_code||item.routeIdentifiers?.[0]||null,
            candidateId:candidate.id,
            state:'adj5_prerequisites_ready',
            requiredProposals:prerequisites,
            followUp:{
              action:'taxi_route.promote',
              candidateId:candidate.id,
              associationId:association.id,
              condition:'only_after_all_ADJ5_prerequisites_are_independently_approved'
            },
            automaticApproval:false
          });
        }else{
          blocked.push({
            evidenceId:item.evidenceId,
            association,
            routeCode:candidate.route_code||item.routeIdentifiers?.[0]||null,
            candidateId:candidate.id,
            state:'blocked',
            reason:'adj5_prerequisite_evidence_incomplete',
            blocks,
            automaticApproval:false
          });
        }
        continue;
      }

      blocked.push({
        evidenceId:item.evidenceId,
        association,
        routeCode:candidate.route_code||item.routeIdentifiers?.[0]||null,
        candidateId:candidate.id,
        state:'blocked',
        reason:validation.error,
        validation,
        automaticApproval:false
      });
      continue;
    }

    if(item.rankMatches?.length===1){
      const rank=item.rankMatches[0];
      const evidence=await viableRankCandidates(db,rank.id,association.id);
      if(evidence.viable.length===1){
        rankUnlocks.push({
          evidenceId:item.evidenceId,
          association,
          rank,
          state:'adj5_proposal_ready',
          requiredProposals:[{
            action:'taxi_rank_association.assign',
            rankId:rank.id,
            candidateId:evidence.viable[0].candidateId,
            associationId:association.id
          }],
          automaticApproval:false
        });
      }else{
        blocked.push({
          evidenceId:item.evidenceId,
          association,
          rank,
          state:'blocked',
          reason:evidence.viable.length===0
            ? 'no_viable_rank_association_candidate'
            : 'multiple_viable_rank_association_candidates',
          viableCandidateIds:evidence.viable.map(x=>x.candidateId),
          rejected:evidence.rejected,
          automaticApproval:false
        });
      }
    }
  }

  const uniqueRankUnlocks=dedupe(rankUnlocks,item=>
    item.requiredProposals.map(p=>[p.action,p.candidateId,p.associationId].join(':')).join('|')
  );
  const uniqueRouteUnlocks=dedupe(routeUnlocks,item=>
    [item.state,item.candidateId,item.association.id].join(':')
  );
  const uniqueBlocked=dedupe(blocked,item=>
    [item.reason,item.candidateId||item.rank?.id||item.evidenceId,item.association.id].join(':')
  );

  const states=[...uniqueRankUnlocks,...uniqueRouteUnlocks,...uniqueBlocked].reduce((acc,item)=>{
    acc[item.state]=(acc[item.state]||0)+1;
    return acc;
  },{});

  return {
    mode:'tn7_national_18_post_canonicalisation_unlock',
    gate:'TN7-NATIONAL-18',
    province:'KwaZulu-Natal',
    targetAssociations:NATIONAL18_ASSOCIATION_NAMES,
    summary:{
      targetedEvidenceRows:targetedRows.length,
      rankAdj5Ready:uniqueRankUnlocks.length,
      routeAdj6Ready:uniqueRouteUnlocks.filter(x=>x.state==='adj6_proposal_ready').length,
      routeAdj5PrerequisitesReady:uniqueRouteUnlocks.filter(x=>x.state==='adj5_prerequisites_ready').length,
      blocked:uniqueBlocked.length,
      states
    },
    policy:{
      reclassificationOnly:true,
      existingAdj5ValidationRequired:true,
      existingAdj6ValidationRequired:true,
      automaticProposalCreation:false,
      automaticApproval:false,
      canonicalMutation:false
    },
    rankUnlocks:uniqueRankUnlocks,
    routeUnlocks:uniqueRouteUnlocks,
    blocked:uniqueBlocked
  };
}
