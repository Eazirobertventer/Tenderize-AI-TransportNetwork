import { createHash, randomUUID } from 'node:crypto';
import { appendOperatorAuditEvent } from './operator-audit.mjs';

function actorRole(actor){
  if(actor?.roles?.includes('admin')) return 'admin';
  if(actor?.roles?.includes('approver')) return 'approver';
  if(actor?.roles?.includes('reviewer')) return 'reviewer';
  return null;
}

function canonicalize(value){
  if(value instanceof Date) return value.toISOString();
  if(Array.isArray(value)) return value.map(canonicalize);
  if(value && typeof value==='object'){
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key=>[key,canonicalize(value[key])])
    );
  }
  return value;
}

export function canonicalStateHash(value){
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

export function dualControlEnabled(env=process.env){
  return env.OPERATOR_DUAL_CONTROL_ENABLED==='true';
}

function proposalView(row){
  if(!row) return null;
  return {
    id:row.id,
    action:row.action,
    targetEntityType:row.target_entity_type,
    targetEntityId:row.target_entity_id,
    intendedChange:row.intended_change,
    beforeState:row.before_state,
    beforeStateHash:row.before_state_hash,
    evidence:row.evidence,
    rationale:row.rationale,
    proposer:{
      subject:row.proposer_subject,
      displayName:row.proposer_display_name,
      role:row.proposer_role
    },
    proposalIdempotencyKey:row.proposal_idempotency_key,
    proposedAt:row.proposed_at,
    status:row.status,
    decision:row.decision_actor_subject ? {
      subject:row.decision_actor_subject,
      displayName:row.decision_actor_display_name,
      role:row.decision_actor_role,
      rationale:row.decision_rationale,
      evidence:row.decision_evidence,
      idempotencyKey:row.decision_idempotency_key,
      decidedAt:row.decided_at
    } : null,
    approvedAuditEventId:row.approved_audit_event_id
  };
}

async function loadProposal(client,proposalId,{forUpdate=false}={}){
  const result=await client.query(
    `SELECT
       id::text,
       action,
       target_entity_type,
       target_entity_id::text,
       intended_change,
       before_state,
       before_state_hash,
       evidence,
       rationale,
       proposer_subject,
       proposer_display_name,
       proposer_role,
       proposal_idempotency_key,
       proposed_at,
       status,
       decision_actor_subject,
       decision_actor_display_name,
       decision_actor_role,
       decision_rationale,
       decision_evidence,
       decision_idempotency_key,
       decided_at,
       approved_audit_event_id::text
     FROM operator_decision_proposal
     WHERE id=$1::uuid
     ${forUpdate?'FOR UPDATE':''}`,
    [proposalId]
  );
  return result.rows[0] || null;
}

async function loadDataIssue(client,issueId,{forUpdate=false}={}){
  const result=await client.query(
    `SELECT
       id::text,
       entity_type,
       entity_id::text,
       issue_type,
       severity,
       summary,
       detail,
       status,
       created_at,
       resolved_at
     FROM data_issue
     WHERE id=$1::uuid
     ${forUpdate?'FOR UPDATE':''}`,
    [issueId]
  );
  return result.rows[0] || null;
}

async function existingDecisionByKey(client,actorSubject,idempotencyKey){
  const result=await client.query(
    `SELECT
       id::text,
       action,
       target_entity_type,
       target_entity_id::text,
       intended_change,
       before_state,
       before_state_hash,
       evidence,
       rationale,
       proposer_subject,
       proposer_display_name,
       proposer_role,
       proposal_idempotency_key,
       proposed_at,
       status,
       decision_actor_subject,
       decision_actor_display_name,
       decision_actor_role,
       decision_rationale,
       decision_evidence,
       decision_idempotency_key,
       decided_at,
       approved_audit_event_id::text
     FROM operator_decision_proposal
     WHERE decision_actor_subject=$1
       AND decision_idempotency_key=$2
     LIMIT 1`,
    [actorSubject,idempotencyKey]
  );
  return result.rows[0] || null;
}

async function existingProposalByCreateKey(client,actorSubject,action,idempotencyKey){
  const result=await client.query(
    `SELECT
       id::text,
       action,
       target_entity_type,
       target_entity_id::text,
       intended_change,
       before_state,
       before_state_hash,
       evidence,
       rationale,
       proposer_subject,
       proposer_display_name,
       proposer_role,
       proposal_idempotency_key,
       proposed_at,
       status,
       decision_actor_subject,
       decision_actor_display_name,
       decision_actor_role,
       decision_rationale,
       decision_evidence,
       decision_idempotency_key,
       decided_at,
       approved_audit_event_id::text
     FROM operator_decision_proposal
     WHERE proposer_subject=$1
       AND action=$2
       AND proposal_idempotency_key=$3
     LIMIT 1`,
    [actorSubject,action,idempotencyKey]
  );
  return result.rows[0] || null;
}

function decisionReplay(row,actor,idempotencyKey,status){
  return row &&
    row.status===status &&
    row.decision_actor_subject===actor.subject &&
    row.decision_idempotency_key===idempotencyKey;
}

export async function getDecisionProposal(pool,proposalId){
  if(!pool) return null;
  const row=await loadProposal(pool,proposalId);
  return proposalView(row);
}

export async function createDataIssueDeferProposal(pool,{
  issueId,
  actor,
  idempotencyKey,
  rationale,
  evidence,
  expectedStatus,
  requestId=randomUUID()
}){
  if(!pool) return {status:503,payload:{error:'database_not_configured'}};
  if(!dualControlEnabled()){
    return {status:503,payload:{error:'dual_control_disabled',mutationEnabled:false}};
  }

  const action='data_issue.defer';
  const role=actorRole(actor);
  const client=await pool.connect();

  try{
    await client.query('BEGIN');

    const replayBeforeLock=await existingProposalByCreateKey(client,actor.subject,action,idempotencyKey);
    if(replayBeforeLock){
      if(replayBeforeLock.target_entity_id!==issueId){
        await client.query('ROLLBACK');
        return {status:409,payload:{error:'proposal_idempotency_key_conflict'}};
      }
      await client.query('COMMIT');
      return {status:200,payload:{replay:true,proposal:proposalView(replayBeforeLock)}};
    }

    const issue=await loadDataIssue(client,issueId,{forUpdate:true});
    if(!issue){
      await client.query('ROLLBACK');
      return {status:404,payload:{error:'data_issue_not_found'}};
    }

    const replayAfterLock=await existingProposalByCreateKey(client,actor.subject,action,idempotencyKey);
    if(replayAfterLock){
      if(replayAfterLock.target_entity_id!==issueId){
        await client.query('ROLLBACK');
        return {status:409,payload:{error:'proposal_idempotency_key_conflict'}};
      }
      await client.query('COMMIT');
      return {status:200,payload:{replay:true,proposal:proposalView(replayAfterLock)}};
    }

    if(issue.status!==expectedStatus){
      await client.query('ROLLBACK');
      return {
        status:409,
        payload:{error:'data_issue_status_conflict',expectedStatus,currentStatus:issue.status}
      };
    }

    if(!['open','reviewing'].includes(issue.status)){
      await client.query('ROLLBACK');
      return {
        status:409,
        payload:{error:'data_issue_not_proposable_for_defer',currentStatus:issue.status}
      };
    }

    const beforeState=canonicalize(issue);
    const beforeStateHash=canonicalStateHash(beforeState);
    const intendedChange={
      status:'deferred',
      resolvedAt:null,
      expectedStatus
    };

    const insert=await client.query(
      `INSERT INTO operator_decision_proposal (
         action,
         target_entity_type,
         target_entity_id,
         intended_change,
         before_state,
         before_state_hash,
         evidence,
         rationale,
         proposer_subject,
         proposer_display_name,
         proposer_role,
         proposal_idempotency_key
       ) VALUES (
         $1,'data_issue',$2::uuid,$3::jsonb,$4::jsonb,$5,$6::jsonb,$7,$8,$9,$10,$11
       )
       RETURNING
         id::text,
         action,
         target_entity_type,
         target_entity_id::text,
         intended_change,
         before_state,
         before_state_hash,
         evidence,
         rationale,
         proposer_subject,
         proposer_display_name,
         proposer_role,
         proposal_idempotency_key,
         proposed_at,
         status,
         decision_actor_subject,
         decision_actor_display_name,
         decision_actor_role,
         decision_rationale,
         decision_evidence,
         decision_idempotency_key,
         decided_at,
         approved_audit_event_id::text`,
      [
        action,
        issueId,
        JSON.stringify(intendedChange),
        JSON.stringify(beforeState),
        beforeStateHash,
        JSON.stringify(evidence || {}),
        rationale,
        actor.subject,
        actor.displayName,
        role,
        idempotencyKey
      ]
    );

    const proposal=insert.rows[0];

    await appendOperatorAuditEvent(client,{
      actor,
      action:'decision_proposal.create',
      entityType:'operator_decision_proposal',
      entityId:proposal.id,
      requestId,
      idempotencyKey,
      beforeState:null,
      afterState:proposalView(proposal),
      evidence,
      rationale,
      metadata:{
        gate:'TN7-ADJUDICATION-3',
        targetEntityType:'data_issue',
        targetEntityId:issueId,
        proposedAction:action,
        beforeStateHash
      }
    });

    await client.query('COMMIT');

    return {status:201,payload:{replay:false,proposal:proposalView(proposal)}};
  }catch(error){
    try{await client.query('ROLLBACK');}catch{}
    throw error;
  }finally{
    client.release();
  }
}

export async function approveDecisionProposal(pool,{
  proposalId,
  actor,
  idempotencyKey,
  rationale,
  evidence,
  requestId=randomUUID()
}){
  if(!pool) return {status:503,payload:{error:'database_not_configured'}};
  if(!dualControlEnabled()){
    return {status:503,payload:{error:'dual_control_disabled',mutationEnabled:false}};
  }

  const client=await pool.connect();
  const role=actorRole(actor);

  try{
    await client.query('BEGIN');

    const existingDecision=await existingDecisionByKey(client,actor.subject,idempotencyKey);
    if(existingDecision && existingDecision.id!==proposalId){
      await client.query('ROLLBACK');
      return {status:409,payload:{error:'decision_idempotency_key_conflict'}};
    }

    const proposal=await loadProposal(client,proposalId,{forUpdate:true});
    if(!proposal){
      await client.query('ROLLBACK');
      return {status:404,payload:{error:'decision_proposal_not_found'}};
    }

    if(decisionReplay(proposal,actor,idempotencyKey,'approved')){
      await client.query('COMMIT');
      return {status:200,payload:{replay:true,proposal:proposalView(proposal)}};
    }

    if(proposal.status!=='proposed'){
      await client.query('ROLLBACK');
      return {status:409,payload:{error:'decision_proposal_not_pending',status:proposal.status}};
    }

    if(proposal.proposer_subject===actor.subject){
      await client.query('ROLLBACK');
      return {status:403,payload:{error:'decision_proposal_self_approval_forbidden'}};
    }

    if(proposal.action!=='data_issue.defer' || proposal.target_entity_type!=='data_issue'){
      await client.query('ROLLBACK');
      return {status:422,payload:{error:'decision_proposal_action_not_supported'}};
    }

    const issue=await loadDataIssue(client,proposal.target_entity_id,{forUpdate:true});
    if(!issue){
      await client.query('ROLLBACK');
      return {status:409,payload:{error:'decision_proposal_target_missing'}};
    }

    const currentState=canonicalize(issue);
    const currentHash=canonicalStateHash(currentState);
    if(currentHash!==proposal.before_state_hash){
      await client.query('ROLLBACK');
      return {
        status:409,
        payload:{
          error:'decision_proposal_stale_before_state',
          proposedBeforeStateHash:proposal.before_state_hash,
          currentBeforeStateHash:currentHash
        }
      };
    }

    const expectedStatus=proposal.intended_change?.expectedStatus;
    if(!['open','reviewing'].includes(expectedStatus) || issue.status!==expectedStatus){
      await client.query('ROLLBACK');
      return {
        status:409,
        payload:{
          error:'decision_proposal_state_conflict',
          expectedStatus:expectedStatus || null,
          currentStatus:issue.status
        }
      };
    }

    const updateIssue=await client.query(
      `UPDATE data_issue
       SET status='deferred',
           resolved_at=NULL
       WHERE id=$1::uuid
         AND status=$2
       RETURNING
         id::text,
         entity_type,
         entity_id::text,
         issue_type,
         severity,
         summary,
         detail,
         status,
         created_at,
         resolved_at`,
      [proposal.target_entity_id,expectedStatus]
    );
    const afterIssue=updateIssue.rows[0];

    if(!afterIssue){
      await client.query('ROLLBACK');
      return {status:409,payload:{error:'decision_proposal_state_conflict'}};
    }

    const canonicalAudit=await appendOperatorAuditEvent(client,{
      actor,
      action:'data_issue.defer',
      entityType:'data_issue',
      entityId:proposal.target_entity_id,
      requestId,
      idempotencyKey,
      beforeState:currentState,
      afterState:canonicalize(afterIssue),
      evidence:{
        proposalId:proposal.id,
        proposalEvidence:proposal.evidence,
        approvalEvidence:evidence
      },
      rationale:proposal.rationale,
      metadata:{
        gate:'TN7-ADJUDICATION-3',
        dualControl:true,
        proposerSubject:proposal.proposer_subject,
        approverSubject:actor.subject,
        proposalBeforeStateHash:proposal.before_state_hash
      }
    });

    const updateProposal=await client.query(
      `UPDATE operator_decision_proposal
       SET status='approved',
           decision_actor_subject=$2,
           decision_actor_display_name=$3,
           decision_actor_role=$4,
           decision_rationale=$5,
           decision_evidence=$6::jsonb,
           decision_idempotency_key=$7,
           decided_at=now(),
           approved_audit_event_id=$8::uuid
       WHERE id=$1::uuid
         AND status='proposed'
       RETURNING
         id::text,
         action,
         target_entity_type,
         target_entity_id::text,
         intended_change,
         before_state,
         before_state_hash,
         evidence,
         rationale,
         proposer_subject,
         proposer_display_name,
         proposer_role,
         proposal_idempotency_key,
         proposed_at,
         status,
         decision_actor_subject,
         decision_actor_display_name,
         decision_actor_role,
         decision_rationale,
         decision_evidence,
         decision_idempotency_key,
         decided_at,
         approved_audit_event_id::text`,
      [
        proposalId,
        actor.subject,
        actor.displayName,
        role,
        rationale,
        JSON.stringify(evidence || {}),
        idempotencyKey,
        canonicalAudit.id
      ]
    );
    const approved=updateProposal.rows[0];

    await appendOperatorAuditEvent(client,{
      actor,
      action:'decision_proposal.approve',
      entityType:'operator_decision_proposal',
      entityId:proposalId,
      requestId,
      idempotencyKey,
      beforeState:proposalView(proposal),
      afterState:proposalView(approved),
      evidence,
      rationale,
      metadata:{
        gate:'TN7-ADJUDICATION-3',
        canonicalAuditEventId:canonicalAudit.id,
        targetEntityType:proposal.target_entity_type,
        targetEntityId:proposal.target_entity_id,
        proposedAction:proposal.action
      }
    });

    await client.query('COMMIT');

    return {
      status:200,
      payload:{
        replay:false,
        proposal:proposalView(approved),
        canonicalMutation:{
          action:'data_issue.defer',
          auditEventId:canonicalAudit.id,
          issue:canonicalize(afterIssue)
        }
      }
    };
  }catch(error){
    try{await client.query('ROLLBACK');}catch{}
    throw error;
  }finally{
    client.release();
  }
}

export async function rejectDecisionProposal(pool,{
  proposalId,
  actor,
  idempotencyKey,
  rationale,
  evidence,
  requestId=randomUUID()
}){
  if(!pool) return {status:503,payload:{error:'database_not_configured'}};
  if(!dualControlEnabled()){
    return {status:503,payload:{error:'dual_control_disabled',mutationEnabled:false}};
  }

  const client=await pool.connect();
  const role=actorRole(actor);

  try{
    await client.query('BEGIN');

    const existingDecision=await existingDecisionByKey(client,actor.subject,idempotencyKey);
    if(existingDecision && existingDecision.id!==proposalId){
      await client.query('ROLLBACK');
      return {status:409,payload:{error:'decision_idempotency_key_conflict'}};
    }

    const proposal=await loadProposal(client,proposalId,{forUpdate:true});
    if(!proposal){
      await client.query('ROLLBACK');
      return {status:404,payload:{error:'decision_proposal_not_found'}};
    }

    if(decisionReplay(proposal,actor,idempotencyKey,'rejected')){
      await client.query('COMMIT');
      return {status:200,payload:{replay:true,proposal:proposalView(proposal)}};
    }

    if(proposal.status!=='proposed'){
      await client.query('ROLLBACK');
      return {status:409,payload:{error:'decision_proposal_not_pending',status:proposal.status}};
    }

    if(proposal.proposer_subject===actor.subject){
      await client.query('ROLLBACK');
      return {status:403,payload:{error:'decision_proposal_self_decision_forbidden'}};
    }

    const result=await client.query(
      `UPDATE operator_decision_proposal
       SET status='rejected',
           decision_actor_subject=$2,
           decision_actor_display_name=$3,
           decision_actor_role=$4,
           decision_rationale=$5,
           decision_evidence=$6::jsonb,
           decision_idempotency_key=$7,
           decided_at=now()
       WHERE id=$1::uuid
         AND status='proposed'
       RETURNING
         id::text,
         action,
         target_entity_type,
         target_entity_id::text,
         intended_change,
         before_state,
         before_state_hash,
         evidence,
         rationale,
         proposer_subject,
         proposer_display_name,
         proposer_role,
         proposal_idempotency_key,
         proposed_at,
         status,
         decision_actor_subject,
         decision_actor_display_name,
         decision_actor_role,
         decision_rationale,
         decision_evidence,
         decision_idempotency_key,
         decided_at,
         approved_audit_event_id::text`,
      [proposalId,actor.subject,actor.displayName,role,rationale,JSON.stringify(evidence || {}),idempotencyKey]
    );
    const rejected=result.rows[0];

    await appendOperatorAuditEvent(client,{
      actor,
      action:'decision_proposal.reject',
      entityType:'operator_decision_proposal',
      entityId:proposalId,
      requestId,
      idempotencyKey,
      beforeState:proposalView(proposal),
      afterState:proposalView(rejected),
      evidence,
      rationale,
      metadata:{
        gate:'TN7-ADJUDICATION-3',
        proposedAction:proposal.action,
        targetEntityType:proposal.target_entity_type,
        targetEntityId:proposal.target_entity_id
      }
    });

    await client.query('COMMIT');
    return {status:200,payload:{replay:false,proposal:proposalView(rejected)}};
  }catch(error){
    try{await client.query('ROLLBACK');}catch{}
    throw error;
  }finally{
    client.release();
  }
}

export async function withdrawDecisionProposal(pool,{
  proposalId,
  actor,
  idempotencyKey,
  rationale,
  evidence,
  requestId=randomUUID()
}){
  if(!pool) return {status:503,payload:{error:'database_not_configured'}};
  if(!dualControlEnabled()){
    return {status:503,payload:{error:'dual_control_disabled',mutationEnabled:false}};
  }

  const client=await pool.connect();
  const role=actorRole(actor);

  try{
    await client.query('BEGIN');

    const existingDecision=await existingDecisionByKey(client,actor.subject,idempotencyKey);
    if(existingDecision && existingDecision.id!==proposalId){
      await client.query('ROLLBACK');
      return {status:409,payload:{error:'decision_idempotency_key_conflict'}};
    }

    const proposal=await loadProposal(client,proposalId,{forUpdate:true});
    if(!proposal){
      await client.query('ROLLBACK');
      return {status:404,payload:{error:'decision_proposal_not_found'}};
    }

    if(decisionReplay(proposal,actor,idempotencyKey,'withdrawn')){
      await client.query('COMMIT');
      return {status:200,payload:{replay:true,proposal:proposalView(proposal)}};
    }

    if(proposal.status!=='proposed'){
      await client.query('ROLLBACK');
      return {status:409,payload:{error:'decision_proposal_not_pending',status:proposal.status}};
    }

    if(proposal.proposer_subject!==actor.subject && !actor.roles?.includes('admin')){
      await client.query('ROLLBACK');
      return {status:403,payload:{error:'decision_proposal_withdraw_forbidden'}};
    }

    const result=await client.query(
      `UPDATE operator_decision_proposal
       SET status='withdrawn',
           decision_actor_subject=$2,
           decision_actor_display_name=$3,
           decision_actor_role=$4,
           decision_rationale=$5,
           decision_evidence=$6::jsonb,
           decision_idempotency_key=$7,
           decided_at=now()
       WHERE id=$1::uuid
         AND status='proposed'
       RETURNING
         id::text,
         action,
         target_entity_type,
         target_entity_id::text,
         intended_change,
         before_state,
         before_state_hash,
         evidence,
         rationale,
         proposer_subject,
         proposer_display_name,
         proposer_role,
         proposal_idempotency_key,
         proposed_at,
         status,
         decision_actor_subject,
         decision_actor_display_name,
         decision_actor_role,
         decision_rationale,
         decision_evidence,
         decision_idempotency_key,
         decided_at,
         approved_audit_event_id::text`,
      [proposalId,actor.subject,actor.displayName,role,rationale,JSON.stringify(evidence || {}),idempotencyKey]
    );
    const withdrawn=result.rows[0];

    await appendOperatorAuditEvent(client,{
      actor,
      action:'decision_proposal.withdraw',
      entityType:'operator_decision_proposal',
      entityId:proposalId,
      requestId,
      idempotencyKey,
      beforeState:proposalView(proposal),
      afterState:proposalView(withdrawn),
      evidence,
      rationale,
      metadata:{
        gate:'TN7-ADJUDICATION-3',
        proposedAction:proposal.action,
        targetEntityType:proposal.target_entity_type,
        targetEntityId:proposal.target_entity_id
      }
    });

    await client.query('COMMIT');
    return {status:200,payload:{replay:false,proposal:proposalView(withdrawn)}};
  }catch(error){
    try{await client.query('ROLLBACK');}catch{}
    throw error;
  }finally{
    client.release();
  }
}
