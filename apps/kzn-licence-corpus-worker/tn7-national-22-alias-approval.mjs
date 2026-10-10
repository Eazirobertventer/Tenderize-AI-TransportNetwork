import pg from 'pg';
import { approveDecisionProposal } from '../transport-api/src/operator-proposals.mjs';

const {Pool}=pg;
const PROPOSAL_ID='057d2830-760d-4bb1-a02b-4f39190e2db6';

async function inventory(pool){
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

export async function executeNational22AliasApproval({
  pool,
  execute=false,
  approver
}={}){
  if(!pool) throw new Error('pool_required');
  if(!approver?.subject) throw new Error('approver_subject_required');
  if(!approver?.roles?.includes('approver') && !approver?.roles?.includes('admin')){
    throw new Error('approver_role_required');
  }

  const proposal=(await pool.query(
    `SELECT id::text,status,action,target_entity_type,target_entity_id::text,
            intended_change,proposer_subject,decision_actor_subject,approved_audit_event_id::text
       FROM operator_decision_proposal
       WHERE id=$1::uuid`,
    [PROPOSAL_ID]
  )).rows[0];

  if(!proposal) throw new Error('national22_alias_proposal_missing');
  if(proposal.action!=='taxi_rank.alias.add') throw new Error('national22_wrong_action');
  if(proposal.target_entity_id!=='acadacb7-ae3b-4581-a28b-ba445af280ba') throw new Error('national22_wrong_target');
  if(proposal.intended_change?.alias!=='Mbazwana Taxi Rank') throw new Error('national22_wrong_alias');
  if(proposal.proposer_subject===approver.subject) throw new Error('national22_self_approval_forbidden');
  if(!['proposed','approved'].includes(proposal.status)) throw new Error('national22_invalid_proposal_state');

  const before=await inventory(pool);

  if(!execute){
    return {
      mode:'tn7_national_22_mbazwana_alias_approval',
      execution:'dry_run',
      proposal,
      approver:{subject:approver.subject,displayName:approver.displayName,roles:approver.roles},
      before,
      policy:{
        independentApproval:true,
        selfApprovalForbidden:true,
        idempotentDecision:true,
        canonicalAliasMutationOnApproval:true
      }
    };
  }

  const result=await approveDecisionProposal(pool,{
    proposalId:PROPOSAL_ID,
    actor:approver,
    idempotencyKey:'tn7-national22-mbazwana-alias-approve',
    rationale:'TN7-NATIONAL-22: independently approve Mbazwana Taxi Rank as an alias of official KZN DoT rank KRPUMD002 after municipal location corroboration and collision review.',
    evidence:{
      gate:'TN7-NATIONAL-22',
      sourceGate:'TN7-NATIONAL-21',
      independentApproval:true,
      mbazwana:{
        alias:'Mbazwana Taxi Rank',
        targetRankId:'acadacb7-ae3b-4581-a28b-ba445af280ba',
        targetCanonicalName:'KRPUMD002',
        municipalDistanceMetres:57.5
      }
    }
  });

  const after=await inventory(pool);
  const rank=(await pool.query(
    `SELECT id::text,canonical_name,aliases,province,verification_status::text
       FROM taxi_rank WHERE id=$1::uuid`,
    ['acadacb7-ae3b-4581-a28b-ba445af280ba']
  )).rows[0];
  const registry=(await pool.query(
    `SELECT id::text,entity_type,entity_id::text,alias,normalized_alias
       FROM transport_entity_alias
       WHERE entity_type='taxi_rank'
         AND normalized_alias='mbazwana taxi rank'`
  )).rows;

  return {
    mode:'tn7_national_22_mbazwana_alias_approval',
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
    proof:{
      rank,
      aliasRegistryRows:registry,
      aliasApplied:(rank?.aliases||[]).includes('Mbazwana Taxi Rank'),
      registryApplied:registry.length===1
    }
  };
}

if(import.meta.url===`file://${process.argv[1]}`){
  if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:false,max:2});
  try{
    const result=await executeNational22AliasApproval({
      pool,
      execute:process.env.NATIONAL22_EXECUTE_ALIAS_APPROVAL==='true',
      approver:{
        subject:String(process.env.NATIONAL22_APPROVER_SUBJECT||'').trim(),
        displayName:String(process.env.NATIONAL22_APPROVER_DISPLAY_NAME||'').trim(),
        roles:[String(process.env.NATIONAL22_APPROVER_ROLE||'approver').trim()]
      }
    });
    console.log(JSON.stringify({event:'tn7_national_22_alias_approval',...result}));
    if(result.execution==='approval'){
      const ok=
        result.result.status===200 &&
        result.result.proposal?.status==='approved' &&
        result.proof.aliasApplied &&
        result.proof.registryApplied &&
        result.before.ranks===result.after.ranks &&
        result.before.associations===result.after.associations &&
        result.before.routes===result.after.routes;
      if(!ok) process.exitCode=1;
    }
  }finally{
    await pool.end();
  }
}
