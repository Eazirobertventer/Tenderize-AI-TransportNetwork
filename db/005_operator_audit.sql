BEGIN;

CREATE TABLE IF NOT EXISTS operator_audit_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_subject text NOT NULL,
  actor_display_name text,
  actor_role text NOT NULL CHECK (actor_role IN ('reviewer','approver','admin')),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  request_id text NOT NULL,
  idempotency_key text,
  before_state jsonb,
  after_state jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  rationale text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS operator_audit_event_actor_idx
  ON operator_audit_event (actor_subject,occurred_at DESC);

CREATE INDEX IF NOT EXISTS operator_audit_event_entity_idx
  ON operator_audit_event (entity_type,entity_id,occurred_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS operator_audit_event_idempotency_idx
  ON operator_audit_event (actor_subject,action,idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION reject_operator_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'operator_audit_event is append-only';
END;
$$;

DROP TRIGGER IF EXISTS operator_audit_event_immutable ON operator_audit_event;

CREATE TRIGGER operator_audit_event_immutable
BEFORE UPDATE OR DELETE ON operator_audit_event
FOR EACH ROW
EXECUTE FUNCTION reject_operator_audit_event_mutation();

COMMIT;
