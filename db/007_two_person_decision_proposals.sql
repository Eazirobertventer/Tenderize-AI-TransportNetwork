BEGIN;

CREATE TABLE IF NOT EXISTS operator_decision_proposal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  target_entity_type text NOT NULL,
  target_entity_id uuid NOT NULL,
  intended_change jsonb NOT NULL,
  before_state jsonb NOT NULL,
  before_state_hash text NOT NULL CHECK (before_state_hash ~ '^[0-9a-f]{64}$'),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  rationale text NOT NULL,
  proposer_subject text NOT NULL,
  proposer_display_name text,
  proposer_role text NOT NULL CHECK (proposer_role IN ('reviewer','approver','admin')),
  proposal_idempotency_key text NOT NULL,
  proposed_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','approved','rejected','withdrawn')),
  decision_actor_subject text,
  decision_actor_display_name text,
  decision_actor_role text CHECK (decision_actor_role IS NULL OR decision_actor_role IN ('approver','admin')),
  decision_rationale text,
  decision_evidence jsonb,
  decision_idempotency_key text,
  decided_at timestamptz,
  approved_audit_event_id uuid REFERENCES operator_audit_event(id),
  CONSTRAINT proposal_decision_fields_consistent CHECK (
    (status='proposed'
      AND decision_actor_subject IS NULL
      AND decision_actor_role IS NULL
      AND decision_idempotency_key IS NULL
      AND decided_at IS NULL
      AND approved_audit_event_id IS NULL)
    OR
    (status IN ('approved','rejected')
      AND decision_actor_subject IS NOT NULL
      AND decision_actor_role IS NOT NULL
      AND decision_rationale IS NOT NULL
      AND decision_idempotency_key IS NOT NULL
      AND decided_at IS NOT NULL)
    OR
    (status='withdrawn'
      AND decision_actor_subject IS NOT NULL
      AND decision_rationale IS NOT NULL
      AND decision_idempotency_key IS NOT NULL
      AND decided_at IS NOT NULL
      AND approved_audit_event_id IS NULL)
  ),
  CONSTRAINT proposal_approval_audit_consistent CHECK (
    (status='approved' AND approved_audit_event_id IS NOT NULL)
    OR (status<>'approved' AND approved_audit_event_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS operator_decision_proposal_create_idempotency_idx
  ON operator_decision_proposal (proposer_subject,action,proposal_idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS operator_decision_proposal_decision_idempotency_idx
  ON operator_decision_proposal (decision_actor_subject,decision_idempotency_key)
  WHERE decision_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS operator_decision_proposal_target_idx
  ON operator_decision_proposal (target_entity_type,target_entity_id,proposed_at DESC);

CREATE INDEX IF NOT EXISTS operator_decision_proposal_status_idx
  ON operator_decision_proposal (status,proposed_at DESC);

CREATE OR REPLACE FUNCTION guard_operator_decision_proposal_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'operator_decision_proposal cannot be deleted';
  END IF;

  IF OLD.id IS DISTINCT FROM NEW.id
     OR OLD.action IS DISTINCT FROM NEW.action
     OR OLD.target_entity_type IS DISTINCT FROM NEW.target_entity_type
     OR OLD.target_entity_id IS DISTINCT FROM NEW.target_entity_id
     OR OLD.intended_change IS DISTINCT FROM NEW.intended_change
     OR OLD.before_state IS DISTINCT FROM NEW.before_state
     OR OLD.before_state_hash IS DISTINCT FROM NEW.before_state_hash
     OR OLD.evidence IS DISTINCT FROM NEW.evidence
     OR OLD.rationale IS DISTINCT FROM NEW.rationale
     OR OLD.proposer_subject IS DISTINCT FROM NEW.proposer_subject
     OR OLD.proposer_display_name IS DISTINCT FROM NEW.proposer_display_name
     OR OLD.proposer_role IS DISTINCT FROM NEW.proposer_role
     OR OLD.proposal_idempotency_key IS DISTINCT FROM NEW.proposal_idempotency_key
     OR OLD.proposed_at IS DISTINCT FROM NEW.proposed_at THEN
    RAISE EXCEPTION 'operator_decision_proposal immutable proposal fields cannot change';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS operator_decision_proposal_guard ON operator_decision_proposal;

CREATE TRIGGER operator_decision_proposal_guard
BEFORE UPDATE OR DELETE ON operator_decision_proposal
FOR EACH ROW
EXECUTE FUNCTION guard_operator_decision_proposal_mutation();

COMMIT;
