BEGIN;

ALTER TABLE taxi_association
  ADD COLUMN IF NOT EXISTS merged_into_association_id uuid REFERENCES taxi_association(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS merged_at timestamptz,
  ADD COLUMN IF NOT EXISTS merge_proposal_id uuid REFERENCES operator_decision_proposal(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS merge_audit_event_id uuid REFERENCES operator_audit_event(id) ON DELETE RESTRICT;

ALTER TABLE taxi_association
  DROP CONSTRAINT IF EXISTS taxi_association_merge_state_consistent;

ALTER TABLE taxi_association
  ADD CONSTRAINT taxi_association_merge_state_consistent CHECK (
    (
      merged_into_association_id IS NULL
      AND merged_at IS NULL
      AND merge_proposal_id IS NULL
      AND merge_audit_event_id IS NULL
    )
    OR
    (
      merged_into_association_id IS NOT NULL
      AND merged_at IS NOT NULL
      AND merge_proposal_id IS NOT NULL
      AND merge_audit_event_id IS NOT NULL
      AND merged_into_association_id <> id
    )
  );

CREATE INDEX IF NOT EXISTS taxi_association_merged_into_idx
  ON taxi_association (merged_into_association_id)
  WHERE merged_into_association_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS taxi_association_merge_lineage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survivor_association_id uuid NOT NULL REFERENCES taxi_association(id) ON DELETE RESTRICT,
  duplicate_association_id uuid NOT NULL UNIQUE REFERENCES taxi_association(id) ON DELETE RESTRICT,
  proposal_id uuid NOT NULL UNIQUE REFERENCES operator_decision_proposal(id) ON DELETE RESTRICT,
  merge_audit_event_id uuid NOT NULL UNIQUE REFERENCES operator_audit_event(id) ON DELETE RESTRICT,
  survivor_before_state jsonb NOT NULL,
  duplicate_before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  redirect_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  merged_at timestamptz NOT NULL DEFAULT now(),
  CHECK (survivor_association_id <> duplicate_association_id)
);

CREATE INDEX IF NOT EXISTS taxi_association_merge_lineage_survivor_idx
  ON taxi_association_merge_lineage (survivor_association_id,merged_at DESC);

CREATE OR REPLACE FUNCTION guard_merged_taxi_association_tombstone()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.merged_into_association_id IS NOT NULL THEN
    RAISE EXCEPTION 'merged taxi_association tombstone is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS taxi_association_merged_tombstone_guard ON taxi_association;

CREATE TRIGGER taxi_association_merged_tombstone_guard
BEFORE UPDATE OR DELETE ON taxi_association
FOR EACH ROW
EXECUTE FUNCTION guard_merged_taxi_association_tombstone();

COMMIT;
