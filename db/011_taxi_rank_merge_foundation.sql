BEGIN;

ALTER TABLE taxi_rank
  ADD COLUMN IF NOT EXISTS merged_into_rank_id uuid REFERENCES taxi_rank(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS merged_at timestamptz,
  ADD COLUMN IF NOT EXISTS merge_proposal_id uuid REFERENCES operator_decision_proposal(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS merge_audit_event_id uuid REFERENCES operator_audit_event(id) ON DELETE RESTRICT;

ALTER TABLE taxi_rank
  DROP CONSTRAINT IF EXISTS taxi_rank_merge_state_consistent;

ALTER TABLE taxi_rank
  ADD CONSTRAINT taxi_rank_merge_state_consistent CHECK (
    (
      merged_into_rank_id IS NULL
      AND merged_at IS NULL
      AND merge_proposal_id IS NULL
      AND merge_audit_event_id IS NULL
    )
    OR
    (
      merged_into_rank_id IS NOT NULL
      AND merged_at IS NOT NULL
      AND merge_proposal_id IS NOT NULL
      AND merge_audit_event_id IS NOT NULL
      AND merged_into_rank_id <> id
    )
  );

CREATE INDEX IF NOT EXISTS taxi_rank_merged_into_idx
  ON taxi_rank (merged_into_rank_id)
  WHERE merged_into_rank_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS taxi_rank_merge_lineage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survivor_rank_id uuid NOT NULL REFERENCES taxi_rank(id) ON DELETE RESTRICT,
  duplicate_rank_id uuid NOT NULL UNIQUE REFERENCES taxi_rank(id) ON DELETE RESTRICT,
  proposal_id uuid NOT NULL UNIQUE REFERENCES operator_decision_proposal(id) ON DELETE RESTRICT,
  merge_audit_event_id uuid NOT NULL UNIQUE REFERENCES operator_audit_event(id) ON DELETE RESTRICT,
  survivor_before_state jsonb NOT NULL,
  duplicate_before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  redirect_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  merged_at timestamptz NOT NULL DEFAULT now(),
  CHECK (survivor_rank_id <> duplicate_rank_id)
);

CREATE INDEX IF NOT EXISTS taxi_rank_merge_lineage_survivor_idx
  ON taxi_rank_merge_lineage (survivor_rank_id,merged_at DESC);

CREATE OR REPLACE FUNCTION guard_merged_taxi_rank_tombstone()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.merged_into_rank_id IS NOT NULL THEN
    RAISE EXCEPTION 'merged taxi_rank tombstone is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS taxi_rank_merged_tombstone_guard ON taxi_rank;

CREATE TRIGGER taxi_rank_merged_tombstone_guard
BEFORE UPDATE OR DELETE ON taxi_rank
FOR EACH ROW
EXECUTE FUNCTION guard_merged_taxi_rank_tombstone();

COMMIT;
