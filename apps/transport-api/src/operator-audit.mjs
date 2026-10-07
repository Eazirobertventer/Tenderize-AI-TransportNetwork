import { randomUUID } from 'node:crypto';

export async function appendOperatorAuditEvent(client,{
  actor,
  action,
  entityType,
  entityId=null,
  requestId=randomUUID(),
  idempotencyKey=null,
  beforeState=null,
  afterState=null,
  evidence={},
  rationale=null,
  metadata={}
}){
  if(!actor?.subject) throw new Error('audit_actor_required');
  if(!action) throw new Error('audit_action_required');
  if(!entityType) throw new Error('audit_entity_type_required');

  const role=actor.roles?.includes('admin')
    ? 'admin'
    : actor.roles?.includes('approver')
      ? 'approver'
      : 'reviewer';

  const result=await client.query(
    `INSERT INTO operator_audit_event (
       actor_subject,
       actor_display_name,
       actor_role,
       action,
       entity_type,
       entity_id,
       request_id,
       idempotency_key,
       before_state,
       after_state,
       evidence,
       rationale,
       metadata
     ) VALUES (
       $1,$2,$3,$4,$5,$6::uuid,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13::jsonb
     )
     RETURNING id::text,occurred_at`,
    [
      actor.subject,
      actor.displayName,
      role,
      action,
      entityType,
      entityId,
      requestId,
      idempotencyKey,
      JSON.stringify(beforeState),
      JSON.stringify(afterState),
      JSON.stringify(evidence || {}),
      rationale,
      JSON.stringify(metadata || {})
    ]
  );

  return result.rows[0];
}
