import pg from 'pg';
import {
  buildAssociationCreationSnapshot,
  validateAssociationCreationSnapshot
} from '../transport-api/src/operator-association-create.mjs';
import { canonicalStateHash } from '../transport-api/src/operator-proposals.mjs';
import { loadCachedEvidenceArtifact } from './artifact-cache.mjs';

const {Pool}=pg;

function canonicalize(value){
  if(value instanceof Date) return value.toISOString();
  if(Array.isArray(value)) return value.map(canonicalize);
  if(value && typeof value==='object'){
    return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonicalize(value[k])]));
  }
  return value;
}

async function inventory(client){
  const r=await client.query(`
    SELECT
      (SELECT count(*)::int FROM taxi_rank) AS ranks,
      (SELECT count(*)::int FROM taxi_association) AS associations,
      (SELECT count(*)::int FROM taxi_route) AS routes,
      (SELECT count(*)::int FROM rank_association_candidate) AS rank_association_candidates,
      (SELECT count(*)::int FROM route_candidate) AS route_candidates
  `);
  return r.rows[0];
}

function expectedSourceKey(url){
  if(String(url).includes('media.lawlibrary.org.za')) return 'kzn-gazette-lawlibrary-mirror';
  if(String(url).includes('uthukela.gov.za')) return 'kzn-gazette-uthukela-mirror';
  return null;
}

export async function reviewNational16(client){
  const before=await inventory(client);
  const proposals=(await client.query(`
    SELECT
      id::text,action,target_entity_type,target_entity_id::text,
      intended_change,before_state,before_state_hash,evidence,rationale,
      proposer_subject,proposer_display_name,proposer_role,
      proposal_idempotency_key,proposed_at,status,
      decision_actor_subject,decision_actor_role,decision_idempotency_key,
      approved_audit_event_id::text
    FROM operator_decision_proposal
    WHERE proposer_subject='tn7-national15-controlled-batch'
      AND action='taxi_association.create'
    ORDER BY proposed_at,id
  `)).rows;

  const sources=(await client.query(`
    SELECT id::text,source_key,source_name,authority,source_class::text,source_url,official,legacy
    FROM source_registry
    WHERE source_key IN ('kzn-gazette-lawlibrary-mirror','kzn-gazette-uthukela-mirror')
    ORDER BY source_key
  `)).rows;
  const sourceByKey=new Map(sources.map(x=>[x.source_key,x]));

  const items=[];
  for(const proposal of proposals){
    const intended=proposal.intended_change||{};
    const snapshot=await buildAssociationCreationSnapshot(client,{
      canonicalName:intended.canonicalName,
      acronym:intended.acronym,
      registrationNumber:intended.registrationNumber,
      affiliation:intended.affiliation,
      province:intended.province,
      district:intended.district,
      municipality:intended.municipality,
      address:intended.address,
      verificationStatus:intended.verificationStatus,
      lock:false
    });
    const validation=validateAssociationCreationSnapshot(snapshot);
    const currentHash=canonicalStateHash(canonicalize(snapshot));
    const dates=proposal.evidence?.recurrence?.distinctEvidenceDates||[];
    const documentIds=proposal.evidence?.recurrence?.documentIds||[];
    const urls=proposal.evidence?.recurrence?.sourceUrls||[];

    const lineage=[];
    for(let index=0;index<urls.length;index++){
      const url=urls[index];
      const sourceKey=expectedSourceKey(url);
      const source=sourceByKey.get(sourceKey)||null;
      let cached={enabled:false,hit:false};
      try{
        cached=await loadCachedEvidenceArtifact(url);
      }catch(error){
        cached={enabled:true,hit:false,error:String(error?.message||error)};
      }
      const checksum=cached.hit ? cached.checksum : null;
      lineage.push({
        sourceKey,
        sourceRegistryId:source?.id||null,
        documentId:documentIds[index]||null,
        documentDate:dates[index]||null,
        sourceUrl:url,
        authority:cached.manifest?.authority||source?.authority||null,
        retrievalMirror:cached.manifest?.retrievalMirror||null,
        checksum,
        bytes:cached.hit ? cached.bytes : null,
        contentType:cached.hit ? cached.contentType : null,
        cacheHit:Boolean(cached.hit),
        registryReady:Boolean(source),
        approvalLineagePayloadReady:Boolean(
          source && cached.hit && /^[0-9a-f]{64}$/.test(String(checksum||'')) &&
          documentIds[index] && dates[index]
        )
      });
    }

    const fourEyes={
      proposerSubject:proposal.proposer_subject,
      independentApproverRequired:true,
      selfApprovalForbidden:true,
      eligibleApproverMustDifferFrom:proposal.proposer_subject
    };

    const checks={
      proposedState:proposal.status==='proposed',
      noDecision:proposal.decision_actor_subject===null && proposal.decision_idempotency_key===null,
      targetIdNull:proposal.target_entity_id===null,
      actionValid:proposal.action==='taxi_association.create' && proposal.target_entity_type==='taxi_association',
      snapshotValid:validation.ok===true,
      beforeStateFresh:currentHash===proposal.before_state_hash,
      authoritativeRecurrence:new Set(dates.filter(Boolean)).size>=2,
      twoSourceDocuments:urls.length>=2 && documentIds.length>=2,
      sourceRegistryMapped:lineage.length>=2 && lineage.every(x=>x.registryReady),
      sourceLineagePayloadReady:lineage.length>=2 && lineage.every(x=>x.approvalLineagePayloadReady),
      approvalPathSourceRecordWriter:true
    };

    const hardBlockers=Object.entries(checks).filter(([,ok])=>!ok).map(([key])=>key);

    items.push({
      proposalId:proposal.id,
      canonicalName:intended.canonicalName,
      priority:proposal.evidence?.priority||null,
      checks,
      hardBlockers,
      fourEyes,
      lineage,
      approvalEvidenceTemplate:{sourceLineage:lineage.map(row=>({
        sourceKey:row.sourceKey,
        documentId:row.documentId,
        documentDate:row.documentDate,
        sourceUrl:row.sourceUrl,
        checksum:row.checksum,
        authority:row.authority,
        retrievalMirror:row.retrievalMirror
      }))},
      approvalReadiness:hardBlockers.length===0 ? 'ready' : 'hold',
      proposalStatus:proposal.status,
      canonicalMutation:false
    });
  }

  const after=await inventory(client);
  return {
    mode:'tn7_national_16_independent_review',
    gate:'TN7-NATIONAL-16',
    summary:{
      proposalsReviewed:items.length,
      ready:items.filter(x=>x.approvalReadiness==='ready').length,
      hold:items.filter(x=>x.approvalReadiness==='hold').length,
      freshSnapshots:items.filter(x=>x.checks.beforeStateFresh).length,
      sourceRegistryMapped:items.filter(x=>x.checks.sourceRegistryMapped).length,
      fourEyesRequired:items.length
    },
    canonicalInventory:{before,after,unchanged:JSON.stringify(before)===JSON.stringify(after)},
    policy:{
      reviewOnly:true,
      noProposalStatusMutation:true,
      noApproval:true,
      noCanonicalMutation:true,
      independentApproverRequired:true,
      sourceRecordLineageRequiredForApproval:true
    },
    items
  };
}

if(import.meta.url===`file://${process.argv[1]}`){
  if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:false,max:1});
  const client=await pool.connect();
  try{
    await client.query('BEGIN READ ONLY');
    const result=await reviewNational16(client);
    await client.query('ROLLBACK');
    console.log(JSON.stringify({event:'tn7_national_16_review',...result}));
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{
    client.release();
    await pool.end();
  }
}
