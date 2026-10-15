function uniq(values=[]){
  return [...new Set(values.filter(value=>value!==null && value!==undefined && value!==''))];
}

function boundedScore(value,max){
  return Math.min(Math.max(Number(value)||0,0),max);
}

function priorityFor(group){
  const documentScore=Math.min(group.documentIds.length,3)*10;
  const recurrenceScore=Math.min(group.observations,5)*4;
  const routeScore=Math.min(group.routeIdentifiers.length,4)*5;
  const rankScore=Math.min(group.rankMentions.length,5)*3;
  const confidenceScore=Math.round(boundedScore(group.maxExtractionConfidence,1)*15);
  const networkScore=Math.min(group.routeCandidateIds.length,5)*4 + Math.min(group.rankIds.length,5)*3;
  const score=Math.min(documentScore+recurrenceScore+routeScore+rankScore+confidenceScore+networkScore,100);

  let band='P4';
  if(score>=70) band='P1';
  else if(score>=50) band='P2';
  else if(score>=30) band='P3';

  return {score,band};
}

function nextActionFor(group){
  if(group.associationMatchIds.length>1){
    return {
      state:'human_review_required',
      action:null,
      reason:'multiple_canonical_association_matches',
      proposalEligible:false
    };
  }

  if(group.bucketCounts.route_candidate_evidence_ready){
    if(group.associationMatchIds.length!==1){
      return {
        state:'identity_resolution_required',
        action:null,
        reason:'route_evidence_without_unique_canonical_association',
        proposalEligible:false
      };
    }
    if(group.routeCandidateIds.length!==1){
      return {
        state:'human_review_required',
        action:null,
        reason:'route_candidate_identity_not_unique',
        proposalEligible:false
      };
    }
    return {
      state:'controlled_route_adjudication_ready',
      action:'taxi_route.promote',
      gate:'ADJ6',
      proposalEligible:true,
      associationId:group.associationMatchIds[0],
      candidateId:group.routeCandidateIds[0]
    };
  }

  if(group.bucketCounts.rank_association_evidence_ready){
    if(group.associationMatchIds.length!==1){
      return {
        state:'identity_resolution_required',
        action:null,
        reason:'rank_evidence_without_unique_canonical_association',
        proposalEligible:false
      };
    }
    if(group.rankIds.length!==1){
      return {
        state:'human_review_required',
        action:null,
        reason:'rank_identity_not_unique',
        proposalEligible:false
      };
    }
    return {
      state:'controlled_relationship_review',
      action:'taxi_rank_association.assign',
      gate:'ADJ5',
      proposalEligible:false,
      reason:'requires_existing_rank_association_candidate'
    };
  }

  if(group.bucketCounts.association_identity_pending){
    if(group.distinctEvidenceDates.length>=2){
      return {
        state:'controlled_association_identity_review',
        action:'taxi_association.create_or_alias_review',
        gate:'TN7-NATIONAL-6/Controlled Association Creation',
        proposalEligible:false,
        reason:'requires_identity_resolver_before_proposal'
      };
    }
    return {
      state:'collect_additional_identity_evidence',
      action:null,
      proposalEligible:false,
      reason:'single_authoritative_date_does_not_satisfy_identity_recurrence'
    };
  }

  if(group.bucketCounts.association_only_evidence){
    if(group.associationMatchIds.length===1){
      return {
        state:'relationship_evidence_review',
        action:null,
        proposalEligible:false,
        associationId:group.associationMatchIds[0],
        reason:'association_resolved_but_no_unique_rank_or_route_target'
      };
    }
  }

  if(group.bucketCounts.conflict || group.bucketCounts.review_required){
    return {
      state:'human_review_required',
      action:null,
      proposalEligible:false,
      reason:'conflicting_or_ambiguous_evidence'
    };
  }

  return {
    state:'evidence_collection_required',
    action:null,
    proposalEligible:false,
    reason:'insufficient_deterministic_target'
  };
}

export function buildEvidenceBacklog(queueItems=[]){
  const groups=new Map();

  for(const item of queueItems){
    const key=item.normalizedAssociationLabel || 'unlabelled:'+item.evidenceId;
    if(!groups.has(key)){
      groups.set(key,{
        normalizedAssociationLabel:item.normalizedAssociationLabel||null,
        displayLabels:[],
        evidenceIds:[],
        observations:0,
        documentIds:[],
        distinctEvidenceDates:[],
        sourceUrls:[],
        authorities:[],
        routeIdentifiers:[],
        rankMentions:[],
        associationMatchIds:[],
        associationMatches:[],
        routeCandidateIds:[],
        rankIds:[],
        bucketCounts:{},
        maxExtractionConfidence:0
      });
    }

    const group=groups.get(key);
    group.observations+=1;
    group.displayLabels.push(item.associationLabel);
    group.evidenceIds.push(item.evidenceId);
    group.documentIds.push(item.documentId);
    group.distinctEvidenceDates.push(item.rawEvidence?.documentDate || item.documentDate || null);
    group.sourceUrls.push(item.sourceUrl);
    group.authorities.push(item.authority);
    group.routeIdentifiers.push(...(item.routeIdentifiers||[]));
    group.rankMentions.push(...(item.rankMentions||[]));
    group.associationMatches.push(...(item.associationMatches||[]));
    group.associationMatchIds.push(...(item.associationMatches||[]).map(x=>x.id));
    group.routeCandidateIds.push(...(item.routeCandidateMatches||[]).map(x=>x.id));
    group.rankIds.push(...(item.rankMatches||[]).map(x=>x.id));
    group.bucketCounts[item.bucket]=(group.bucketCounts[item.bucket]||0)+1;
    group.maxExtractionConfidence=Math.max(group.maxExtractionConfidence,Number(item.extractionConfidence||0));
  }

  const items=[];
  for(const group of groups.values()){
    group.displayLabels=uniq(group.displayLabels);
    group.evidenceIds=uniq(group.evidenceIds);
    group.documentIds=uniq(group.documentIds);
    group.distinctEvidenceDates=uniq(group.distinctEvidenceDates);
    group.sourceUrls=uniq(group.sourceUrls);
    group.authorities=uniq(group.authorities);
    group.routeIdentifiers=uniq(group.routeIdentifiers);
    group.rankMentions=uniq(group.rankMentions);
    group.associationMatchIds=uniq(group.associationMatchIds);
    group.routeCandidateIds=uniq(group.routeCandidateIds);
    group.rankIds=uniq(group.rankIds);

    const seenAssociation=new Set();
    group.associationMatches=group.associationMatches.filter(row=>{
      if(seenAssociation.has(row.id)) return false;
      seenAssociation.add(row.id);
      return true;
    });

    const priority=priorityFor(group);
    const nextAction=nextActionFor(group);

    items.push({
      caseKey:group.normalizedAssociationLabel || group.evidenceIds[0],
      associationLabel:group.displayLabels[0]||null,
      normalizedAssociationLabel:group.normalizedAssociationLabel,
      observations:group.observations,
      evidence:{
        evidenceIds:group.evidenceIds,
        documentIds:group.documentIds,
        distinctEvidenceDates:group.distinctEvidenceDates,
        sourceUrls:group.sourceUrls,
        authorities:group.authorities,
        routeIdentifiers:group.routeIdentifiers,
        rankMentions:group.rankMentions,
        maxExtractionConfidence:group.maxExtractionConfidence
      },
      matches:{
        associations:group.associationMatches,
        associationIds:group.associationMatchIds,
        routeCandidateIds:group.routeCandidateIds,
        rankIds:group.rankIds
      },
      bucketCounts:group.bucketCounts,
      priority,
      nextAction,
      automaticApproval:false,
      canonicalMutation:false
    });
  }

  items.sort((a,b)=>
    a.priority.band.localeCompare(b.priority.band) ||
    b.priority.score-a.priority.score ||
    b.observations-a.observations ||
    String(a.caseKey).localeCompare(String(b.caseKey))
  );

  const summary={
    evidenceRows:queueItems.length,
    groupedCases:items.length,
    priorities:items.reduce((acc,item)=>{
      acc[item.priority.band]=(acc[item.priority.band]||0)+1;
      return acc;
    },{}),
    nextStates:items.reduce((acc,item)=>{
      acc[item.nextAction.state]=(acc[item.nextAction.state]||0)+1;
      return acc;
    },{}),
    proposalReady:items.filter(item=>item.nextAction.proposalEligible).length
  };

  return {
    mode:'tn7_national_12_kzn_evidence_backlog',
    province:'KwaZulu-Natal',
    policy:{
      groupedByNormalizedAssociationIdentity:true,
      automaticApproval:false,
      automaticCanonicalMutation:false,
      proposalCreationRequiresExistingControlledWorkflow:true,
      identityCreationRequiresAuthoritativeRecurrence:true
    },
    summary,
    items
  };
}
