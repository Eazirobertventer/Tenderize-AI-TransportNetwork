BEGIN;

ALTER TABLE taxi_rank_association
  ADD COLUMN IF NOT EXISTS relationship_id uuid;

UPDATE taxi_rank_association
SET relationship_id=gen_random_uuid()
WHERE relationship_id IS NULL;

ALTER TABLE taxi_rank_association
  ALTER COLUMN relationship_id SET DEFAULT gen_random_uuid();

ALTER TABLE taxi_rank_association
  ALTER COLUMN relationship_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS taxi_rank_association_relationship_id_unique
  ON taxi_rank_association (relationship_id);

CREATE TABLE IF NOT EXISTS rank_association_promotion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES rank_association_candidate(id) ON DELETE RESTRICT,
  relationship_id uuid NOT NULL,
  taxi_rank_id uuid NOT NULL,
  association_id uuid NOT NULL,
  promoted_by_proposal_id uuid NOT NULL REFERENCES operator_decision_proposal(id) ON DELETE RESTRICT,
  promoted_audit_event_id uuid NOT NULL REFERENCES operator_audit_event(id) ON DELETE RESTRICT,
  promoted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id),
  UNIQUE (relationship_id),
  UNIQUE (promoted_by_proposal_id),
  FOREIGN KEY (relationship_id) REFERENCES taxi_rank_association(relationship_id) ON DELETE RESTRICT,
  FOREIGN KEY (taxi_rank_id,association_id)
    REFERENCES taxi_rank_association(taxi_rank_id,association_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS rank_association_promotion_rank_idx
  ON rank_association_promotion (taxi_rank_id,promoted_at DESC);

CREATE INDEX IF NOT EXISTS rank_association_promotion_association_idx
  ON rank_association_promotion (association_id,promoted_at DESC);

COMMIT;
