import { resolveAssociationIdentity } from '../transport-api/src/association-identity-resolution.mjs';

function officialEvidenceFromCase(item){
  const dates=item?.evidence?.distinctEvidenceDates||[];
  const urls=item?.evidence?.sourceUrls||[];
  const authorities=item?.evidence?.authorities||[];
  return dates.map((documentDate,index)=>({
    evidenceType:'provincial_operating_licence_gazette',
    associationLabel:item.associationLabel,
    documentDate,
    sourceUrl:urls[index]||urls[0]||null,
    authority:authorities[0]||'KwaZulu-Natal Provincial Gazette / Government Printing Works'
  }));
}

function controlledOutcome(resolution){
  if(resolution.status==='canonical_identity_resolved_exact'){
    return {
      state:'exact_canonical_match',
      nextControlledAction:'reclassify_evidence_against_existing_association',
      proposalType:null,
      proposalEligible:false
    };
  }
  if(resolution.status==='canonical_identity_variant_review'){
    return {
      state:'deterministic_alias_review',
      nextControlledAction:'review_ADJ4_alias_proposal',
      proposalType:'taxi_association.alias.add',
      proposalEligible:false
    };
  }
  if(resolution.status==='canonical_identity_evidence_ready'){
    return {
      state:'canonical_creation_candidate',
      nextControlledAction:'review_controlled_association_creation_proposal',
      proposalType:'taxi_association.create',
      proposalEligible:false
    };
  }
  return {
    state:'manual_hold',
    nextControlledAction:'manual_identity_review',
    proposalType:null,
    proposalEligible:false,
    reason:resolution.reason
  };
}

export async function resolveMultiDateAssociationCases(db,backlog){
  if(!db) return null;
  const target=(backlog?.items||[]).filter(item=>
    item.nextAction?.state==='controlled_association_identity_review'
  );

  const items=[];
  for(const item of target){
    const officialEvidence=officialEvidenceFromCase(item);
    const resolution=await resolveAssociationIdentity(db,{
      label:item.associationLabel,
      province:'KwaZulu-Natal',
      officialEvidence,
      linkedRouteCodes:item.evidence?.routeIdentifiers||[]
    });
    items.push({
      caseKey:item.caseKey,
      associationLabel:item.associationLabel,
      priority:item.priority,
      observations:item.observations,
      recurrence:{
        distinctEvidenceDates:item.evidence?.distinctEvidenceDates||[],
        documentIds:item.evidence?.documentIds||[],
        sourceUrls:item.evidence?.sourceUrls||[]
      },
      resolution,
      controlledOutcome:controlledOutcome(resolution),
      automaticApproval:false,
      proposalCreated:false,
      canonicalMutation:false
    });
  }

  const outcomes=items.reduce((acc,item)=>{
    const key=item.controlledOutcome.state;
    acc[key]=(acc[key]||0)+1;
    return acc;
  },{});

  return {
    mode:'tn7_national_14_multi_date_association_identity_resolution',
    gate:'TN7-NATIONAL-14',
    province:'KwaZulu-Natal',
    policy:{
      resolver:'national_association_identity_resolution',
      fuzzyMatching:false,
      deterministicVariantExpansionOnly:true,
      automaticAliasPromotion:false,
      automaticCanonicalCreation:false,
      automaticApproval:false,
      proposalCreation:false,
      canonicalMutation:false
    },
    summary:{
      targetedCases:target.length,
      resolvedCases:items.length,
      outcomes
    },
    items
  };
}
