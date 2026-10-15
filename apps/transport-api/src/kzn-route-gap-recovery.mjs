import { loadKznGazetteEvidenceQueue } from './kzn-gazette-queue.mjs';
import { recoverRouteEvidenceGaps } from './route-evidence-gap-recovery.mjs';

export async function loadKznRouteGapRecovery(pool){
  if(!pool) return null;
  const queue=await loadKznGazetteEvidenceQueue(pool,{limit:250});
  const gaps=(queue?.queue?.items||[])
    .filter(item=>item.bucket==='route_code_not_in_candidate_corpus')
    .map(item=>({
      routeCode:item.routeCode,
      association:item.association,
      rankNarrative:item.rankNarrative,
      source:item.source,
      sourceUrl:item.sourceUrl,
      evidenceOrigin:item.evidenceOrigin,
      associationMatches:item.associationMatches
    }));

  const recovery=await recoverRouteEvidenceGaps(pool,{
    province:'KwaZulu-Natal',
    evidenceRows:gaps,
    limit:25
  });

  return {
    ...recovery,
    mode:'tn7_national_5_kzn_route_candidate_gap_recovery',
    sourceQueue:'TN7-NATIONAL-3',
    expectedGapRows:3,
    selectedGapRows:gaps.length,
    policy:{
      ...recovery.normalizationPolicy,
      routeCandidateCreationRequiresExistingIngestPath:true,
      automaticCandidateCreation:false,
      automaticCanonicalMutation:false
    }
  };
}
