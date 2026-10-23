BEGIN;

ALTER TABLE taxi_route
  ADD COLUMN IF NOT EXISTS source_route_code text;

CREATE TABLE IF NOT EXISTS route_candidate_promotion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL UNIQUE REFERENCES route_candidate(id) ON DELETE RESTRICT,
  source_route_geometry_id uuid NOT NULL UNIQUE REFERENCES source_route_geometry(id) ON DELETE RESTRICT,
  route_id uuid NOT NULL UNIQUE REFERENCES taxi_route(id) ON DELETE RESTRICT,
  source_record_id uuid NOT NULL UNIQUE REFERENCES source_record(id) ON DELETE RESTRICT,
  promoted_by_proposal_id uuid NOT NULL UNIQUE REFERENCES operator_decision_proposal(id) ON DELETE RESTRICT,
  promoted_audit_event_id uuid NOT NULL UNIQUE REFERENCES operator_audit_event(id) ON DELETE RESTRICT,
  promoted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS route_candidate_promotion_route_idx
  ON route_candidate_promotion (route_id,promoted_at DESC);

CREATE INDEX IF NOT EXISTS route_candidate_promotion_candidate_idx
  ON route_candidate_promotion (candidate_id,promoted_at DESC);

COMMIT;
