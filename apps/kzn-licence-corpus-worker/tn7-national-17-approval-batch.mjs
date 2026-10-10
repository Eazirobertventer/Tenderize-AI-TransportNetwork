import pg from 'pg';
import { approveDecisionProposal } from '../transport-api/src/operator-proposals.mjs';
import { loadCachedEvidenceArtifact } from './artifact-cache.mjs';

const {Pool}=pg;

function expectedSourceKey(url){
  if(String(url).includes('media.lawlibrary.org.za')) return 'kzn-gazette-lawlibrary-mirror';
  if(String(url).includes('uthukela.gov.za')) return 'kzn-gazette-uthukela-mirror';
  return null;
}

async function canonicalInventory(pool){
  const r=await pool.query(`
    SELECT
      (SELECT count(*)::int FROM taxi_rank) AS ranks,
      (SELECT count(*)::int FROM taxi_association) AS associations,
      (SELECT count(*)::int FROM taxi_route) AS routes,
      (SELECT count(*)::int FROM rank_association_candidate) AS rank_association_candidates,
      (SELECT count(*)::int FROM route_candidate) AS route_candidates
  `);
  return r.rows[0];
}

async function loadTargetProposals(pool){
  return (await pool.query(`
    SELECT
      id::text,intended_change,evidence,proposer_subject,proposer_display_name,proposer_role,
      proposal_idempotency_key,status,decision_actor_subject,approved_audit_event_id::text
    FROM operator_decision_proposal
    WHERE proposer_subject='tn7-national15-controlled-batch'
      AND action='taxi_association.create'
    ORDER BY proposed_at,id
  `)).rows;
}

async function buildApprovalEvidence(proposal){
  const urls=proposal.evidence?.recurrence?.sourceUrls||[];
  const documentIds=proposal.evidence?.recurrence?.documentIds||[];
  const dates=proposal.evidence?.recurrence?.distinctEvidenceDates||[];
  if(urls.length<2 || documentIds.length<2 || dates.length<2){
    throw new Error('national17_lineage_shape_invalid');
  }

  const sourceLineage=[];
  for(let index=0; index<urls.length; index++){
    const cached=await loadCachedEvidenceArtifact(urls[index]);
    if(!cached.hit) throw new Error('national17_cache_miss:'+urls[index]);
    sourceLineage.push({
      sourceKey:expectedSourceKey(urls[index]),
      documentId:documentIds[index],
      documentDate:dates[index],
      sourceUrl:urls[index],
      checksum:cached.checksum,
      authority:cached.manifest?.authority||'KwaZulu-Natal Provincial Gazette / Government Printing Works',
      retrievalMirror:cached.manifest?.retrievalMirror||null
    });
  }

  if(sourceLineage.some(row=>!row.sourceKey || !/^[0-9a-f]{64}$/.test(row.checksum))){
    throw new Error('national17_lineage_invalid');
  }
  return {
    gate:'TN7-NATIONAL-17',
    sourceGate:'TN7-NATIONAL-16',
    sourceLineage,
    independentApproval:true
  };
}

export async function executeNational17({
  pool,
  execute=false,
  approver
}={}){
  if(!pool) throw new Error('pool_required');
  if(!approver?.subject) throw new Error('independent_approver_subject_required');
  if(!approver?.displayName) throw new Error('independent_approver_display_name_required');
  if(!approver?.roles?.includes('approver') && !approver?.roles?.includes('admin')){
    throw new Error('independent_approver_role_required');
  }

  const proposals=await loadTargetProposals(pool);
  if(proposals.length!==9) throw new Error('national17_expected_nine_proposals');
  if(proposals.some(p=>p.proposer_subject===approver.subject)){
    throw new Error('national17_self_approval_forbidden');
  }
  if(proposals.some(p=>!['proposed','approved'].includes(p.status))){
    throw new Error('national17_proposal_state_invalid');
  }

  const before=await canonicalInventory(pool);
  const planned=[];
  for(const proposal of proposals){
    planned.push({
      proposalId:proposal.id,
      canonicalName:proposal.intended_change?.canonicalName,
      currentStatus:proposal.status,
      approvalEvidence:await buildApprovalEvidence(proposal),
      decisionIdempotencyKey:'tn7-national17-approve-'+proposal.id
    });
  }

  if(!execute){
    return {
      mode:'tn7_national_17_independent_approval_batch',
      execution:'dry_run',
      approver:{subject:approver.subject,displayName:approver.displayName,roles:approver.roles},
      before,
      proposalCount:planned.length,
      planned,
      policy:{
        independentTwoPersonApproval:true,
        proposerSubject:'tn7-national15-controlled-batch',
        approverMustDiffer:true,
        sourceLineageRequired:true,
        canonicalMutationOnApproval:true,
        idempotentDecisionKeys:true
      }
    };
  }

  const results=[];
  for(const item of planned){
    const result=await approveDecisionProposal(pool,{
      proposalId:item.proposalId,
      actor:approver,
      idempotencyKey:item.decisionIdempotencyKey,
      rationale:'TN7-NATIONAL-17: independent approval after NATIONAL-16 source-lineage, collision, freshness, and four-eyes readiness review.',
      evidence:item.approvalEvidence
    });
    results.push({
      proposalId:item.proposalId,
      canonicalName:item.canonicalName,
      status:result.status,
      replay:Boolean(result.payload?.replay),
      error:result.payload?.error||null,
      proposal:result.payload?.proposal||null,
      canonicalMutation:result.payload?.canonicalMutation||null
    });
  }

  const after=await canonicalInventory(pool);
  const approved=results.filter(r=>r.status===200 && r.proposal?.status==='approved');
  const created=results.filter(r=>!r.replay && r.canonicalMutation?.association?.id);
  const replayed=results.filter(r=>r.replay);

  return {
    mode:'tn7_national_17_independent_approval_batch',
    execution:'approval_batch',
    approver:{subject:approver.subject,displayName:approver.displayName,roles:approver.roles},
    before,
    after,
    summary:{
      attempted:results.length,
      approved:approved.length,
      newlyApproved:created.length,
      replayed:replayed.length,
      failed:results.filter(r=>r.status!==200).length,
      sourceRecordsCreated:created.reduce((n,r)=>n+(r.canonicalMutation?.sourceRecordIds?.length||0),0)
    },
    results,
    policy:{
      independentTwoPersonApproval:true,
      proposerSubject:'tn7-national15-controlled-batch',
      approverMustDiffer:true,
      sourceLineageRequired:true,
      canonicalMutationOnApproval:true,
      idempotentDecisionKeys:true
    }
  };
}

if(import.meta.url===`file://${process.argv[1]}`){
  if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  const subject=String(process.env.NATIONAL17_APPROVER_SUBJECT||'').trim();
  const displayName=String(process.env.NATIONAL17_APPROVER_DISPLAY_NAME||'').trim();
  const role=String(process.env.NATIONAL17_APPROVER_ROLE||'approver').trim();
  const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:false,max:2});
  try{
    const result=await executeNational17({
      pool,
      execute:process.env.NATIONAL17_EXECUTE_APPROVALS==='true',
      approver:{subject,displayName,roles:[role]}
    });
    console.log(JSON.stringify({event:'tn7_national_17_result',...result}));
    if(result.execution==='approval_batch'){
      const ok=
        result.summary.attempted===9 &&
        result.summary.approved===9 &&
        result.summary.failed===0 &&
        (
          (result.summary.newlyApproved===9 && result.summary.sourceRecordsCreated===18) ||
          (result.summary.replayed===9)
        );
      if(!ok) process.exitCode=1;
    }
  }finally{
    await pool.end();
  }
}
