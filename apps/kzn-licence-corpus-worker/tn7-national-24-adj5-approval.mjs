import pg from 'pg';
import { approveDecisionProposal } from '../transport-api/src/operator-proposals.mjs';

const {Pool}=pg;

const PROPOSAL_ID='1c77e981-5de9-412a-a149-26e23289cae2';
const CANDIDATE_ID='3d02304d-7024-40d0-ad0f-809b06607687';
const RANK_ID='acadacb7-ae3b-4581-a28b-ba445af280ba';
const ASSOCIATION_ID='1561a588-e225-4af3-b5ca-12ba5e754f4a';

async function inventory(pool){
  const r=await pool.query(`
    SELECT
      (SELECT count(*)::int FROM taxi_rank) AS ranks,
      (SELECT count(*)::int FROM taxi_association) AS associations,
      (SELECT count(*)::int FROM taxi_route) AS routes,
      (SELECT count(*)::int FROM rank_association_candidate) AS rank_association_candidates,
      (SELECT count(*)::int FROM route_candidate) AS route_candidates,
      (SELECT count(*)::int FROM taxi_rank_association) AS rank_associations
  `);
  return r.rows[0];
}

async function loadProof(pool){
  const relationship=(await pool.query(
    `SELECT relationship_id::text,taxi_rank_id::text,association_id::text,
            verification_status::text,confidence,first_seen_at,last_seen_at
       FROM taxi_rank_association
       WHERE taxi_rank_id=$1::uuid AND association_id=$2::uuid`,
    [RANK_ID,ASSOCIATION_ID]
  )).rows;

  const promotion=(await pool.query(
    `SELECT id::text,candidate_id::text,relationship_id::text,
            taxi_rank_id::text,association_id::text,
            promoted_by_proposal_id::text,promoted_audit_event_id::text,promoted_at
       FROM rank_association_promotion
       WHERE candidate_id=$1::uuid`,
    [CANDIDATE_ID]
  )).rows;

  return {relationship,promotion};
}

export async function executeNational24({
  pool,
  execute=false,
  approver
}={}){
  if(!pool) throw new Error('pool_required');
  if(!approver?.subject) throw new Error('independent_approver_subject_required');
  if(!approver?.roles?.includes('approver') && !approver?.roles?.includes('admin')){
    throw new Error('independent_approver_role_required');
  }

  const proposal=(await pool.query(
    `SELECT id::text,status,action,target_entity_type,target_entity_id::text,
            intended_change,proposer_subject,decision_actor_subject,
            decision_actor_role,decision_idempotency_key,approved_audit_event_id::text
       FROM operator_decision_proposal WHERE id=$1::uuid`,
    [PROPOSAL_ID]
  )).rows[0];

  if(!proposal) throw new Error('national24_proposal_missing');
  if(proposal.action!=='taxi_rank_association.assign') throw new Error('national24_wrong_action');
  if(proposal.target_entity_id!==RANK_ID) throw new Error('national24_wrong_rank');
  if(proposal.intended_change?.candidateId!==CANDIDATE_ID) throw new Error('national24_wrong_candidate');
  if(proposal.intended_change?.associationId!==ASSOCIATION_ID) throw new Error('national24_wrong_association');
  if(proposal.proposer_subject===approver.subject) throw new Error('national24_self_approval_forbidden');
  if(!['proposed','approved'].includes(proposal.status)) throw new Error('national24_invalid_proposal_state');

  const before=await inventory(pool);
  const beforeProof=await loadProof(pool);

  if(!execute){
    return {
      mode:'tn7_national_24_mbazwana_adj5_approval',
      execution:'dry_run',
      proposal,
      approver:{subject:approver.subject,displayName:approver.displayName,roles:approver.roles},
      before,
      beforeProof,
      policy:{
        independentApproval:true,
        selfApprovalForbidden:true,
        idempotentDecision:true,
        canonicalRelationshipMutationOnApproval:true,
        candidatePromotionRequired:true
      }
    };
  }

  const result=await approveDecisionProposal(pool,{
    proposalId:PROPOSAL_ID,
    actor:approver,
    idempotencyKey:'tn7-national24-mbazwana-adj5-approve',
    rationale:'TN7-NATIONAL-24: independently approve the evidence-backed Mbazwana rank-to-association assignment after alias resolution, two-date Gazette recurrence, candidate materialisation, and ADJ5 validation.',
    evidence:{
      gate:'TN7-NATIONAL-24',
      sourceGate:'TN7-NATIONAL-23',
      independentApproval:true,
      rank:{id:RANK_ID,canonicalName:'KRPUMD002',alias:'Mbazwana Taxi Rank'},
      association:{id:ASSOCIATION_ID,canonicalName:'MBAZWANA TAXI ASSOCIATION'},
      candidateId:CANDIDATE_ID
    }
  });

  const after=await inventory(pool);
  const proof=await loadProof(pool);

  return {
    mode:'tn7_national_24_mbazwana_adj5_approval',
    execution:'approval',
    approver:{subject:approver.subject,displayName:approver.displayName,roles:approver.roles},
    before,
    after,
    result:{
      status:result.status,
      replay:Boolean(result.payload?.replay),
      error:result.payload?.error||null,
      proposal:result.payload?.proposal||null,
      canonicalMutation:result.payload?.canonicalMutation||null
    },
    proof,
    policy:{
      independentApproval:true,
      selfApprovalForbidden:true,
      idempotentDecision:true,
      canonicalRelationshipMutationOnApproval:true,
      candidatePromotionRequired:true
    }
  };
}

if(import.meta.url===`file://${process.argv[1]}`){
  if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:false,max:2});
  try{
    const result=await executeNational24({
      pool,
      execute:process.env.NATIONAL24_EXECUTE_ADJ5_APPROVAL==='true',
      approver:{
        subject:String(process.env.NATIONAL24_APPROVER_SUBJECT||'').trim(),
        displayName:String(process.env.NATIONAL24_APPROVER_DISPLAY_NAME||'').trim(),
        roles:[String(process.env.NATIONAL24_APPROVER_ROLE||'approver').trim()]
      }
    });
    console.log(JSON.stringify({event:'tn7_national_24_adj5_approval',...result}));
    if(result.execution==='approval'){
      const relationship=result.proof?.relationship||[];
      const promotion=result.proof?.promotion||[];
      const ok=
        result.result.status===200 &&
        result.result.proposal?.status==='approved' &&
        relationship.length===1 &&
        relationship[0].taxi_rank_id===RANK_ID &&
        relationship[0].association_id===ASSOCIATION_ID &&
        promotion.length===1 &&
        promotion[0].candidate_id===CANDIDATE_ID &&
        promotion[0].promoted_by_proposal_id===PROPOSAL_ID &&
        result.after.rank_associations===result.before.rank_associations+(
          result.result.replay?0:1
        );
      if(!ok) process.exitCode=1;
    }
  }finally{
    await pool.end();
  }
}
