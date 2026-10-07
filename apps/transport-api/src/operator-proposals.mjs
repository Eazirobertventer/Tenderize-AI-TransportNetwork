import { createHash, randomUUID } from 'node:crypto';
import { appendOperatorAuditEvent } from './operator-audit.mjs';
import {
  aliasPromotionEnabled,
  aliasActionForEntityType,
  normalizeAlias,
  loadAliasEntity,
  lockAliasClaim,
  findAliasCollision,
  addAliasToEntity,
  registerPromotedAlias
} from './operator-aliases.mjs';
import {
  associationAssignmentEnabled,
  buildRankAssociationSnapshot,
  validateRankAssociationSnapshot,
  insertRankAssociation,
  registerRankAssociationPromotion
} from './operator-association-links.mjs';
import {
  routePromotionEnabled,
  loadRouteCandidatePromotionSnapshot,
  validateRoutePromotionSnapshot,
  insertCanonicalRoute,
  insertRouteSourceRecord,
  markSourceGeometryPromoted,
  registerRouteCandidatePromotion
} from './operator-routes.mjs';
import {
  rankMergeEnabled,
  buildTaxiRankMergeSnapshot,
  validateTaxiRankMergeSnapshot,
  applyTaxiRankMerge
} from './operator-rank-merges.mjs';

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

export async function createAliasProposal(pool,{
  entityType,
  entityId,
  alias,
  actor,
  idempotencyKey,
  rationale,
  evidence,
  requestId=randomUUID()
}){
  if(!pool) return {status:503,payload:{error:'database_not_configured'}};
  if(!dualControlEnabled() || !aliasPromotionEnabled()){
    return {status:503,payload:{error:'alias_promotion_disabled',mutationEnabled:false}};
  }

  const action=aliasActionForEntityType(entityType);
  if(!action){
    return {status:422,payload:{error:'alias_entity_type_not_supported'}};
  }

  const role=actorRole(actor);
  const client=await pool.connect();

  try{
    await client.query('BEGIN');

    const normalized=await normalizeAlias(client,alias);
    if(!normalized.ok){
      await client.query('ROLLBACK');
      return {status:400,payload:{error:normalized.error}};
    }

    const replayBeforeLock=await existingProposalByCreateKey(client,actor.subject,action,idempotencyKey);
    if(replayBeforeLock){
      if(replayBeforeLock.target_entity_id!==entityId ||
         replayBeforeLock.intended_change?.normalizedAlias!==normalized.normalizedAlias){
        await client.query('ROLLBACK');
        return {status:409,payload:{error:'proposal_idempotency_key_conflict'}};
      }
      await client.query('COMMIT');
      return {status:200,payload:{replay:true,proposal:proposalView(replayBeforeLock)}};
    }

    const entity=await loadAliasEntity(client,entityType,entityId,{forUpdate:true});
    if(!entity){
      await client.query('ROLLBACK');
      return {status:404,payload:{error:'alias_target_not_found'}};
    }

    const collision=await findAliasCollision(client,entityType,entityId,normalized.normalizedAlias);
    if(collision){
      await client.query('ROLLBACK');
      return {
        status:409,
        payload:{
          error:collision.sameTarget?'alias_already_present_or_identity':'alias_collision',
          collision
        }
      };
    }

    const replayAfterLock=await existingProposalByCreateKey(client,actor.subject,action,idempotencyKey);
    if(replayAfterLock){
      if(replayAfterLock.target_entity_id!==entityId ||
         replayAfterLock.intended_change?.normalizedAlias!==normalized.normalizedAlias){
        await client.query('ROLLBACK');
        return {status:409,payload:{error:'proposal_idempotency_key_conflict'}};
      }
      await client.query('COMMIT');
      return {status:200,payload:{replay:true,proposal:proposalView(replayAfterLock)}};
    }

    const beforeState=canonicalize(entity);
    const beforeStateHash=canonicalStateHash(beforeState);
    const intendedChange={
      alias:normalized.alias,
      normalizedAlias:normalized.normalizedAlias
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
         $1,$2,$3::uuid,$4::jsonb,$5::jsonb,$6,$7::jsonb,$8,$9,$10,$11,$12
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
        entityType,
        entityId,
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
        gate:'TN7-ADJUDICATION-4',
        targetEntityType:entityType,
        targetEntityId:entityId,
        proposedAction:action,
        alias:normalized.alias,
        normalizedAlias:normalized.normalizedAlias,
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

export async function createRankAssociationAssignmentProposal(pool,{
  candidateId,
  associationId,
  actor,
  idempotencyKey,
  rationale,
  evidence,
  requestId=randomUUID()
}){
  if(!pool) return {status:503,payload:{error:'database_not_configured'}};
  if(!dualControlEnabled() || !associationAssignmentEnabled()){
    return {status:503,payload:{error:'association_assignment_disabled',mutationEnabled:false}};
  }

  const action='taxi_rank_association.assign';
  const role=actorRole(actor);
  const client=await pool.connect();

  try{
    await client.query('BEGIN');

    const replayBeforeLock=await existingProposalByCreateKey(client,actor.subject,action,idempotencyKey);
    if(replayBeforeLock){
      if(replayBeforeLock.intended_change?.candidateId!==candidateId ||
         replayBeforeLock.intended_change?.associationId!==associationId){
        await client.query('ROLLBACK');
        return {status:409,payload:{error:'proposal_idempotency_key_conflict'}};
      }
      await client.query('COMMIT');
      return {status:200,payload:{replay:true,proposal:proposalView(replayBeforeLock)}};
    }

    const snapshot=await buildRankAssociationSnapshot(client,{candidateId,associationId,lock:true});
    const validation=validateRankAssociationSnapshot(snapshot);
    if(!validation.ok){
      await client.query('ROLLBACK');
      return {status:409,payload:validation};
    }

    const replayAfterLock=await existingProposalByCreateKey(client,actor.subject,action,idempotencyKey);
    if(replayAfterLock){
      if(replayAfterLock.intended_change?.candidateId!==candidateId ||
         replayAfterLock.intended_change?.associationId!==associationId){
        await client.query('ROLLBACK');
        return {status:409,payload:{error:'proposal_idempotency_key_conflict'}};
      }
      await client.query('COMMIT');
      return {status:200,payload:{replay:true,proposal:proposalView(replayAfterLock)}};
    }

    const beforeState=canonicalize(snapshot);
    const beforeStateHash=canonicalStateHash(beforeState);
    const intendedChange={
      candidateId,
      taxiRankId:snapshot.rank.id,
      associationId,
      relationshipVerificationStatus:'verified'
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
         $1,'taxi_rank',$2::uuid,$3::jsonb,$4::jsonb,$5,$6::jsonb,$7,$8,$9,$10,$11
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
        snapshot.rank.id,
        JSON.stringify(intendedChange),
        JSON.stringify(beforeState),
        beforeStateHash,
        JSON.stringify({
          ...(evidence || {}),
          candidate:snapshot.candidate,
          sourceCandidateSet:snapshot.candidates
        }),
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
        gate:'TN7-ADJUDICATION-5',
        proposedAction:action,
        candidateId,
        taxiRankId:snapshot.rank.id,
        associationId,
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

export async function createRoutePromotionProposal(pool,{
  candidateId,
  associationId,
  actor,
  idempotencyKey,
  rationale,
  evidence,
  requestId=randomUUID()
}){
  if(!pool) return {status:503,payload:{error:'database_not_configured'}};
  if(!dualControlEnabled() || !routePromotionEnabled()){
    return {status:503,payload:{error:'route_promotion_disabled',mutationEnabled:false}};
  }

  const action='taxi_route.promote';
  const role=actorRole(actor);
  const client=await pool.connect();

  try{
    await client.query('BEGIN');

    const replayBeforeLock=await existingProposalByCreateKey(client,actor.subject,action,idempotencyKey);
    if(replayBeforeLock){
      if(replayBeforeLock.intended_change?.candidateId!==candidateId ||
         replayBeforeLock.intended_change?.associationId!==associationId){
        await client.query('ROLLBACK');
        return {status:409,payload:{error:'proposal_idempotency_key_conflict'}};
      }
      await client.query('COMMIT');
      return {status:200,payload:{replay:true,proposal:proposalView(replayBeforeLock)}};
    }

    const snapshot=await loadRouteCandidatePromotionSnapshot(client,{
      candidateId,
      associationId,
      lock:true
    });
    const validation=validateRoutePromotionSnapshot(snapshot,associationId);
    if(!validation.ok){
      await client.query('ROLLBACK');
      return {status:409,payload:validation};
    }

    const replayAfterLock=await existingProposalByCreateKey(client,actor.subject,action,idempotencyKey);
    if(replayAfterLock){
      if(replayAfterLock.intended_change?.candidateId!==candidateId ||
         replayAfterLock.intended_change?.associationId!==associationId){
        await client.query('ROLLBACK');
        return {status:409,payload:{error:'proposal_idempotency_key_conflict'}};
      }
      await client.query('COMMIT');
      return {status:200,payload:{replay:true,proposal:proposalView(replayAfterLock)}};
    }

    const beforeState=canonicalize(snapshot);
    const beforeStateHash=canonicalStateHash(beforeState);
    const intendedChange={
      candidateId,
      associationId,
      originRankId:snapshot.candidate.originRankId,
      destinationRankId:snapshot.candidate.destinationRankId,
      sourceRouteGeometryId:snapshot.sourceGeometry.id,
      geometryHash:snapshot.sourceGeometry.geometryHash,
      verificationStatus:snapshot.candidate.verificationStatus
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
         $1,'route_candidate',$2::uuid,$3::jsonb,$4::jsonb,$5,$6::jsonb,$7,$8,$9,$10,$11
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
        candidateId,
        JSON.stringify(intendedChange),
        JSON.stringify(beforeState),
        beforeStateHash,
        JSON.stringify({
          ...(evidence || {}),
          routeCandidate:snapshot.candidate,
          sourceGeometry:snapshot.sourceGeometry,
          source:snapshot.source
        }),
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
        gate:'TN7-ADJUDICATION-6',
        proposedAction:action,
        candidateId,
        associationId,
        originRankId:snapshot.candidate.originRankId,
        destinationRankId:snapshot.candidate.destinationRankId,
        sourceRouteGeometryId:snapshot.sourceGeometry.id,
        geometryHash:snapshot.sourceGeometry.geometryHash,
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

export async function createTaxiRankMergeProposal(pool,{
  survivorRankId,
  duplicateRankId,
  actor,
  idempotencyKey,
  rationale,
  evidence,
  requestId=randomUUID()
}){
  if(!pool) return {status:503,payload:{error:'database_not_configured'}};
  if(!dualControlEnabled() || !rankMergeEnabled()){
    return {status:503,payload:{error:'rank_merge_disabled',mutationEnabled:false}};
  }

  const action='taxi_rank.merge';
  const role=actorRole(actor);
  const client=await pool.connect();

  try{
    await client.query('BEGIN');

    const replayBeforeLock=await existingProposalByCreateKey(client,actor.subject,action,idempotencyKey);
    if(replayBeforeLock){
      if(replayBeforeLock.intended_change?.survivorRankId!==survivorRankId ||
         replayBeforeLock.intended_change?.duplicateRankId!==duplicateRankId){
        await client.query('ROLLBACK');
        return {status:409,payload:{error:'proposal_idempotency_key_conflict'}};
      }
      await client.query('COMMIT');
      return {status:200,payload:{replay:true,proposal:proposalView(replayBeforeLock)}};
    }

    const snapshot=await buildTaxiRankMergeSnapshot(client,{
      survivorRankId,
      duplicateRankId,
      lock:true
    });
    const validation=validateTaxiRankMergeSnapshot(snapshot);
    if(!validation.ok){
      await client.query('ROLLBACK');
      return {status:409,payload:validation};
    }

    const replayAfterLock=await existingProposalByCreateKey(client,actor.subject,action,idempotencyKey);
    if(replayAfterLock){
      if(replayAfterLock.intended_change?.survivorRankId!==survivorRankId ||
         replayAfterLock.intended_change?.duplicateRankId!==duplicateRankId){
        await client.query('ROLLBACK');
        return {status:409,payload:{error:'proposal_idempotency_key_conflict'}};
      }
      await client.query('COMMIT');
      return {status:200,payload:{replay:true,proposal:proposalView(replayAfterLock)}};
    }

    const beforeState=canonicalize(snapshot);
    const beforeStateHash=canonicalStateHash(beforeState);
    const intendedChange={
      survivorRankId,
      duplicateRankId,
      action:'merge_duplicate_into_survivor',
      tombstoneDuplicate:true
    };

    const insert=await client.query(
      `INSERT INTO operator_decision_proposal (
         action,target_entity_type,target_entity_id,intended_change,before_state,before_state_hash,
         evidence,rationale,proposer_subject,proposer_display_name,proposer_role,proposal_idempotency_key
       ) VALUES (
         $1,'taxi_rank',$2::uuid,$3::jsonb,$4::jsonb,$5,$6::jsonb,$7,$8,$9,$10,$11
       )
       RETURNING
         id::text,action,target_entity_type,target_entity_id::text,intended_change,before_state,before_state_hash,
         evidence,rationale,proposer_subject,proposer_display_name,proposer_role,proposal_idempotency_key,
         proposed_at,status,decision_actor_subject,decision_actor_display_name,decision_actor_role,
         decision_rationale,decision_evidence,decision_idempotency_key,decided_at,approved_audit_event_id::text`,
      [
        action,
        survivorRankId,
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
        gate:'TN7-ADJUDICATION-7',
        proposedAction:action,
        survivorRankId,
        duplicateRankId,
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

    const isDeferProposal=proposal.action==='data_issue.defer' && proposal.target_entity_type==='data_issue';
    const isAliasProposal=
      (proposal.action==='taxi_rank.alias.add' && proposal.target_entity_type==='taxi_rank') ||
      (proposal.action==='taxi_association.alias.add' && proposal.target_entity_type==='taxi_association');
    const isRankAssociationProposal=
      proposal.action==='taxi_rank_association.assign' &&
      proposal.target_entity_type==='taxi_rank';
    const isRoutePromotionProposal=
      proposal.action==='taxi_route.promote' &&
      proposal.target_entity_type==='route_candidate';
    const isTaxiRankMergeProposal=
      proposal.action==='taxi_rank.merge' &&
      proposal.target_entity_type==='taxi_rank';

    if(!isDeferProposal && !isAliasProposal && !isRankAssociationProposal && !isRoutePromotionProposal && !isTaxiRankMergeProposal){
      await client.query('ROLLBACK');
      return {status:422,payload:{error:'decision_proposal_action_not_supported'}};
    }

    if(isAliasProposal){
      if(!aliasPromotionEnabled()){
        await client.query('ROLLBACK');
        return {status:503,payload:{error:'alias_promotion_disabled',mutationEnabled:false}};
      }

      const alias=proposal.intended_change?.alias;
      const normalizedAlias=proposal.intended_change?.normalizedAlias;
      const normalized=await normalizeAlias(client,alias);
      if(!normalized.ok || normalized.normalizedAlias!==normalizedAlias){
        await client.query('ROLLBACK');
        return {status:409,payload:{error:'decision_proposal_alias_normalization_mismatch'}};
      }

      await lockAliasClaim(client,proposal.target_entity_type,normalizedAlias);

      const entity=await loadAliasEntity(client,proposal.target_entity_type,proposal.target_entity_id,{forUpdate:true});
      if(!entity){
        await client.query('ROLLBACK');
        return {status:409,payload:{error:'decision_proposal_target_missing'}};
      }

      const currentState=canonicalize(entity);
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

      const collision=await findAliasCollision(
        client,
        proposal.target_entity_type,
        proposal.target_entity_id,
        normalizedAlias
      );
      if(collision){
        await client.query('ROLLBACK');
        return {
          status:409,
          payload:{
            error:collision.sameTarget?'alias_already_present_or_identity':'alias_collision',
            collision
          }
        };
      }

      const afterEntity=await addAliasToEntity(
        client,
        proposal.target_entity_type,
        proposal.target_entity_id,
        normalized.alias
      );
      if(!afterEntity){
        await client.query('ROLLBACK');
        return {status:409,payload:{error:'decision_proposal_target_missing'}};
      }

      const canonicalAudit=await appendOperatorAuditEvent(client,{
        actor,
        action:proposal.action,
        entityType:proposal.target_entity_type,
        entityId:proposal.target_entity_id,
        requestId,
        idempotencyKey:'proposal:'+proposal.id+':'+idempotencyKey,
        beforeState:currentState,
        afterState:canonicalize(afterEntity),
        evidence:{
          proposalId:proposal.id,
          proposalEvidence:proposal.evidence,
          approvalEvidence:evidence
        },
        rationale:proposal.rationale,
        metadata:{
          gate:'TN7-ADJUDICATION-4',
          dualControl:true,
          proposerSubject:proposal.proposer_subject,
          approverSubject:actor.subject,
          proposalBeforeStateHash:proposal.before_state_hash,
          alias:normalized.alias,
          normalizedAlias
        }
      });

      const aliasRecord=await registerPromotedAlias(client,{
        entityType:proposal.target_entity_type,
        entityId:proposal.target_entity_id,
        alias:normalized.alias,
        normalizedAlias,
        proposalId:proposal.id,
        auditEventId:canonicalAudit.id
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
          gate:'TN7-ADJUDICATION-4',
          canonicalAuditEventId:canonicalAudit.id,
          aliasRecordId:aliasRecord.id,
          targetEntityType:proposal.target_entity_type,
          targetEntityId:proposal.target_entity_id,
          proposedAction:proposal.action,
          normalizedAlias
        }
      });

      await client.query('COMMIT');

      return {
        status:200,
        payload:{
          replay:false,
          proposal:proposalView(approved),
          canonicalMutation:{
            action:proposal.action,
            auditEventId:canonicalAudit.id,
            aliasRecord,
            entity:canonicalize(afterEntity)
          }
        }
      };
    }

    if(isRankAssociationProposal){
      if(!associationAssignmentEnabled()){
        await client.query('ROLLBACK');
        return {status:503,payload:{error:'association_assignment_disabled',mutationEnabled:false}};
      }

      const candidateId=proposal.intended_change?.candidateId;
      const associationId=proposal.intended_change?.associationId;
      if(!candidateId || !associationId){
        await client.query('ROLLBACK');
        return {status:409,payload:{error:'decision_proposal_relationship_payload_invalid'}};
      }

      const snapshot=await buildRankAssociationSnapshot(client,{
        candidateId,
        associationId,
        lock:true
      });
      const validation=validateRankAssociationSnapshot(snapshot);
      if(!validation.ok){
        await client.query('ROLLBACK');
        return {status:409,payload:validation};
      }

      const currentState=canonicalize(snapshot);
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

      if(snapshot.rank.id!==proposal.target_entity_id){
        await client.query('ROLLBACK');
        return {status:409,payload:{error:'decision_proposal_target_mismatch'}};
      }

      const relationship=await insertRankAssociation(client,{
        rankId:snapshot.rank.id,
        associationId:snapshot.association.id
      });

      const canonicalAudit=await appendOperatorAuditEvent(client,{
        actor,
        action:'taxi_rank_association.assign',
        entityType:'taxi_rank_association',
        entityId:relationship.relationshipId,
        requestId,
        idempotencyKey:'proposal:'+proposal.id+':'+idempotencyKey,
        beforeState:{
          relationship:null,
          snapshot:currentState
        },
        afterState:{
          relationship,
          rank:snapshot.rank,
          association:snapshot.association
        },
        evidence:{
          proposalId:proposal.id,
          candidate:snapshot.candidate,
          proposalEvidence:proposal.evidence,
          approvalEvidence:evidence
        },
        rationale:proposal.rationale,
        metadata:{
          gate:'TN7-ADJUDICATION-5',
          dualControl:true,
          proposerSubject:proposal.proposer_subject,
          approverSubject:actor.subject,
          proposalBeforeStateHash:proposal.before_state_hash,
          candidateId,
          taxiRankId:snapshot.rank.id,
          associationId:snapshot.association.id
        }
      });

      const promotion=await registerRankAssociationPromotion(client,{
        candidateId,
        relationship,
        proposalId:proposal.id,
        auditEventId:canonicalAudit.id
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
          gate:'TN7-ADJUDICATION-5',
          canonicalAuditEventId:canonicalAudit.id,
          promotionId:promotion.id,
          relationshipId:relationship.relationshipId,
          candidateId,
          taxiRankId:snapshot.rank.id,
          associationId:snapshot.association.id,
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
            action:'taxi_rank_association.assign',
            auditEventId:canonicalAudit.id,
            relationship,
            promotion
          }
        }
      };
    }

    if(isRoutePromotionProposal){
      if(!routePromotionEnabled()){
        await client.query('ROLLBACK');
        return {status:503,payload:{error:'route_promotion_disabled',mutationEnabled:false}};
      }

      const candidateId=proposal.intended_change?.candidateId;
      const associationId=proposal.intended_change?.associationId;
      if(!candidateId || !associationId){
        await client.query('ROLLBACK');
        return {status:409,payload:{error:'decision_proposal_route_payload_invalid'}};
      }

      const snapshot=await loadRouteCandidatePromotionSnapshot(client,{
        candidateId,
        associationId,
        lock:true
      });
      const validation=validateRoutePromotionSnapshot(snapshot,associationId);
      if(!validation.ok){
        await client.query('ROLLBACK');
        return {status:409,payload:validation};
      }

      const currentState=canonicalize(snapshot);
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

      if(snapshot.candidate.id!==proposal.target_entity_id){
        await client.query('ROLLBACK');
        return {status:409,payload:{error:'decision_proposal_target_mismatch'}};
      }

      const route=await insertCanonicalRoute(client,snapshot,associationId);
      const sourceRecord=await insertRouteSourceRecord(client,{
        snapshot,
        route,
        proposalId:proposal.id
      });

      const promotedGeometry=await markSourceGeometryPromoted(
        client,
        snapshot.sourceGeometry.id,
        route.id
      );
      if(!promotedGeometry){
        await client.query('ROLLBACK');
        return {status:409,payload:{error:'source_route_geometry_already_promoted'}};
      }

      const canonicalAudit=await appendOperatorAuditEvent(client,{
        actor,
        action:'taxi_route.promote',
        entityType:'taxi_route',
        entityId:route.id,
        requestId,
        idempotencyKey:'proposal:'+proposal.id+':'+idempotencyKey,
        beforeState:{
          route:null,
          snapshot:currentState
        },
        afterState:{
          route,
          sourceRecordId:sourceRecord.id,
          sourceRouteGeometryId:snapshot.sourceGeometry.id,
          geometryHash:snapshot.sourceGeometry.geometryHash
        },
        evidence:{
          proposalId:proposal.id,
          routeCandidate:snapshot.candidate,
          sourceGeometry:snapshot.sourceGeometry,
          source:snapshot.source,
          proposalEvidence:proposal.evidence,
          approvalEvidence:evidence
        },
        rationale:proposal.rationale,
        metadata:{
          gate:'TN7-ADJUDICATION-6',
          dualControl:true,
          proposerSubject:proposal.proposer_subject,
          approverSubject:actor.subject,
          proposalBeforeStateHash:proposal.before_state_hash,
          candidateId,
          routeId:route.id,
          associationId,
          originRankId:snapshot.candidate.originRankId,
          destinationRankId:snapshot.candidate.destinationRankId,
          sourceRouteGeometryId:snapshot.sourceGeometry.id,
          geometryHash:snapshot.sourceGeometry.geometryHash
        }
      });

      const promotion=await registerRouteCandidatePromotion(client,{
        snapshot,
        routeId:route.id,
        sourceRecordId:sourceRecord.id,
        proposalId:proposal.id,
        auditEventId:canonicalAudit.id
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
          gate:'TN7-ADJUDICATION-6',
          canonicalAuditEventId:canonicalAudit.id,
          promotionId:promotion.id,
          routeId:route.id,
          sourceRecordId:sourceRecord.id,
          candidateId,
          sourceRouteGeometryId:snapshot.sourceGeometry.id,
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
            action:'taxi_route.promote',
            auditEventId:canonicalAudit.id,
            route,
            sourceRecordId:sourceRecord.id,
            promotion
          }
        }
      };
    }

    if(isTaxiRankMergeProposal){
      if(!rankMergeEnabled()){
        await client.query('ROLLBACK');
        return {status:503,payload:{error:'rank_merge_disabled',mutationEnabled:false}};
      }

      const survivorRankId=proposal.intended_change?.survivorRankId;
      const duplicateRankId=proposal.intended_change?.duplicateRankId;
      if(!survivorRankId || !duplicateRankId || survivorRankId!==proposal.target_entity_id){
        await client.query('ROLLBACK');
        return {status:409,payload:{error:'decision_proposal_rank_merge_payload_invalid'}};
      }

      const snapshot=await buildTaxiRankMergeSnapshot(client,{
        survivorRankId,
        duplicateRankId,
        lock:true,
        excludeProposalId:proposal.id
      });
      const validation=validateTaxiRankMergeSnapshot(snapshot);
      if(!validation.ok){
        await client.query('ROLLBACK');
        return {status:409,payload:validation};
      }

      const currentState=canonicalize(snapshot);
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

      const canonicalAudit=await appendOperatorAuditEvent(client,{
        actor,
        action:'taxi_rank.merge',
        entityType:'taxi_rank',
        entityId:survivorRankId,
        requestId,
        idempotencyKey:'proposal:'+proposal.id+':'+idempotencyKey,
        beforeState:currentState,
        afterState:{
          survivorRankId,
          duplicateRankId,
          duplicateBecomesTombstone:true
        },
        evidence:{
          proposalId:proposal.id,
          proposalEvidence:proposal.evidence,
          approvalEvidence:evidence
        },
        rationale:proposal.rationale,
        metadata:{
          gate:'TN7-ADJUDICATION-7',
          dualControl:true,
          proposerSubject:proposal.proposer_subject,
          approverSubject:actor.subject,
          proposalBeforeStateHash:proposal.before_state_hash,
          survivorRankId,
          duplicateRankId
        }
      });

      const merge=await applyTaxiRankMerge(client,{
        snapshot,
        proposalId:proposal.id,
        auditEventId:canonicalAudit.id
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
         WHERE id=$1::uuid AND status='proposed'
         RETURNING
           id::text,action,target_entity_type,target_entity_id::text,intended_change,before_state,before_state_hash,
           evidence,rationale,proposer_subject,proposer_display_name,proposer_role,proposal_idempotency_key,
           proposed_at,status,decision_actor_subject,decision_actor_display_name,decision_actor_role,
           decision_rationale,decision_evidence,decision_idempotency_key,decided_at,approved_audit_event_id::text`,
        [proposalId,actor.subject,actor.displayName,role,rationale,JSON.stringify(evidence || {}),idempotencyKey,canonicalAudit.id]
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
          gate:'TN7-ADJUDICATION-7',
          canonicalAuditEventId:canonicalAudit.id,
          mergeLineageId:merge.lineage.id,
          survivorRankId,
          duplicateRankId,
          redirectCounts:merge.counts,
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
            action:'taxi_rank.merge',
            auditEventId:canonicalAudit.id,
            survivor:merge.survivor,
            duplicateTombstone:merge.duplicate,
            redirectCounts:merge.counts,
            lineage:merge.lineage
          }
        }
      };
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
      idempotencyKey:'proposal:'+proposal.id+':'+idempotencyKey,
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
