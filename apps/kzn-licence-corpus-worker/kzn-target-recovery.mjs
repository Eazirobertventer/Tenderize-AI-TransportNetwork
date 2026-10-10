import { recoverRouteEvidenceGaps } from '../transport-api/src/route-evidence-gap-recovery.mjs';
import { recoverRankTargets } from './kzn-rank-target-recovery.mjs';
import {
  buildRankAssociationSnapshot,
  validateRankAssociationSnapshot
} from '../transport-api/src/operator-association-links.mjs';
import {
  loadRouteCandidatePromotionSnapshot,
  validateRoutePromotionSnapshot
} from '../transport-api/src/operator-routes.mjs';

function dedupe(items,keyFn){
  const seen=new Set();
  return items.filter(item=>{
    const key=keyFn(item);
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

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
    if(validation.ok) viable.push({candidateId:row.id,rankId,associationId});
    else rejected.push({candidateId:row.id,error:validation.error});
  }
  return {viable,rejected};
}

export async function buildNational19RecoveryPlan(db,unlockPlan){
  if(!db || !unlockPlan) return null;
  const gaps=unlockPlan.notActionable||[];

  const routeEvidence=[];
  const rankEvidence=[];

  for(const gap of gaps){
    if(gap.reason==='route_identifier_not_in_candidate_corpus'){
      for(const routeCode of gap.routeIdentifiers||[]){
        routeEvidence.push({
          evidenceId:gap.evidenceId,
          routeCode,
          association:gap.association
        });
      }
    }

    if(gap.reason==='rank_mention_not_exactly_mapped'){
      for(const mention of gap.rankMentions||[]){
        rankEvidence.push({
          evidenceId:gap.evidenceId,
          mention,
          association:gap.association
        });
      }
    }
  }

  const routeRecovery=await recoverRouteEvidenceGaps(db,{
    province:'KwaZulu-Natal',
    evidenceRows:dedupe(routeEvidence,item=>[item.evidenceId,item.routeCode].join(':')),
    limit:250
  });

  const rankRecovery=await recoverRankTargets(db,{
    province:'KwaZulu-Natal',
    mentions:dedupe(rankEvidence,item=>[item.evidenceId,item.mention].join(':')),
    limit:500
  });

  const recoveredRouteTargets=[];
  const recoveredRankTargets=[];
  const routeUnlocks=[];
  const rankUnlocks=[];
  const blocks=[];

  for(const item of routeRecovery.items||[]){
    const association=item.association;
    const exact=item.matches?.exactCandidateCode||[];

    if(item.recoveryBucket==='candidate_exists_after_normalization' && exact.length===1){
      const candidate=exact[0];
      recoveredRouteTargets.push({
        evidenceId:item.evidenceId,
        routeCode:item.routeCode,
        association,
        candidateId:candidate.id,
        recoveryBucket:item.recoveryBucket
      });

      const snapshot=await loadRouteCandidatePromotionSnapshot(db,{
        candidateId:candidate.id,
        associationId:association.id,
        lock:false
      });
      const validation=validateRoutePromotionSnapshot(snapshot,association.id);
      if(validation.ok){
        routeUnlocks.push({
          evidenceId:item.evidenceId,
          routeCode:item.routeCode,
          association,
          candidateId:candidate.id,
          state:'adj6_proposal_ready_after_recovery',
          automaticApproval:false
        });
      }else{
        blocks.push({
          evidenceId:item.evidenceId,
          routeCode:item.routeCode,
          association,
          candidateId:candidate.id,
          state:'recovered_target_blocked',
          reason:validation.error,
          stage:'adj6_validation',
          validation,
          automaticApproval:false
        });
      }
      continue;
    }

    if(item.recoveryBucket==='alternate_candidate_identifier' &&
       (item.matches?.alternateCandidateIdentifier||[]).length===1){
      const candidate=item.matches.alternateCandidateIdentifier[0];
      recoveredRouteTargets.push({
        evidenceId:item.evidenceId,
        routeCode:item.routeCode,
        association,
        candidateId:candidate.id,
        recoveryBucket:item.recoveryBucket,
        requiresIdentifierReview:true
      });
      blocks.push({
        evidenceId:item.evidenceId,
        routeCode:item.routeCode,
        association,
        candidateId:candidate.id,
        state:'recovered_target_review_required',
        reason:'alternate_candidate_identifier_requires_review',
        stage:'route_identity',
        automaticApproval:false
      });
    }
  }

  const rankByEvidence=new Map();
  for(const item of rankRecovery.items||[]){
    if(!item.recoveredRank) continue;
    if(!rankByEvidence.has(item.evidenceId)) rankByEvidence.set(item.evidenceId,[]);
    rankByEvidence.get(item.evidenceId).push(item);
  }

  for(const [evidenceId,items] of rankByEvidence){
    const unique=dedupe(items,item=>item.recoveredRank.id);
    const association=items[0].association;

    if(unique.length!==1){
      blocks.push({
        evidenceId,
        association,
        state:'recovered_target_review_required',
        reason:'multiple_deterministically_recovered_ranks_in_evidence',
        recoveredRankIds:unique.map(x=>x.recoveredRank.id),
        stage:'rank_identity',
        automaticApproval:false
      });
      continue;
    }

    const recovered=unique[0];
    const rank=recovered.recoveredRank;
    recoveredRankTargets.push({
      evidenceId,
      association,
      rank:{
        id:rank.id,
        name:rank.canonical_name,
        province:rank.province,
        municipality:rank.municipality,
        town:rank.town
      },
      recoveryBucket:recovered.recoveryBucket
    });

    const candidateEvidence=await viableRankCandidates(db,rank.id,association.id);
    if(candidateEvidence.viable.length===1){
      rankUnlocks.push({
        evidenceId,
        association,
        rank:{
          id:rank.id,
          name:rank.canonical_name
        },
        candidateId:candidateEvidence.viable[0].candidateId,
        state:'adj5_proposal_ready_after_recovery',
        automaticApproval:false
      });
    }else{
      blocks.push({
        evidenceId,
        association,
        rank:{
          id:rank.id,
          name:rank.canonical_name
        },
        state:'recovered_target_blocked',
        reason:candidateEvidence.viable.length===0
          ? 'no_viable_rank_association_candidate_after_recovery'
          : 'multiple_viable_rank_association_candidates_after_recovery',
        viableCandidateIds:candidateEvidence.viable.map(x=>x.candidateId),
        rejected:candidateEvidence.rejected,
        stage:'adj5_validation',
        automaticApproval:false
      });
    }
  }

  const routeBuckets=routeRecovery.buckets||{};
  const rankBuckets=rankRecovery.buckets||{};
  const blockReasons=blocks.reduce((acc,item)=>{
    acc[item.reason]=(acc[item.reason]||0)+1;
    return acc;
  },{});

  return {
    mode:'tn7_national_19_deterministic_target_recovery',
    gate:'TN7-NATIONAL-19',
    province:'KwaZulu-Natal',
    summary:{
      sourceGapRows:gaps.length,
      routeGapRows:gaps.filter(x=>x.reason==='route_identifier_not_in_candidate_corpus').length,
      rankGapRows:gaps.filter(x=>x.reason==='rank_mention_not_exactly_mapped').length,
      routeIdentifiersEvaluated:routeRecovery.evidenceRows,
      rankMentionsEvaluated:rankRecovery.evidenceMentions,
      recoveredRouteTargets:recoveredRouteTargets.length,
      recoveredRankTargets:recoveredRankTargets.length,
      adj6ReadyAfterRecovery:routeUnlocks.length,
      adj5ReadyAfterRecovery:rankUnlocks.length,
      blockedAfterRecovery:blocks.length,
      routeRecoveryBuckets:routeBuckets,
      rankRecoveryBuckets:rankBuckets,
      blockReasons
    },
    policy:{
      deterministicOnly:true,
      routeNormalizationReuse:'national_route_evidence_gap_recovery',
      rankSourceCodeExact:true,
      rankExactCanonicalOrAliasPhrase:true,
      fuzzyMatching:false,
      geographicProximityMatching:false,
      automaticCandidateCreation:false,
      automaticAliasCreation:false,
      automaticProposalCreation:false,
      automaticApproval:false,
      canonicalMutation:false,
      existingAdj5ValidationRequired:true,
      existingAdj6ValidationRequired:true
    },
    routeRecovery,
    rankRecovery,
    recoveredRouteTargets,
    recoveredRankTargets,
    routeUnlocks,
    rankUnlocks,
    blocks
  };
}
