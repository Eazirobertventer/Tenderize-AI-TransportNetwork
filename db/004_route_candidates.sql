BEGIN;

CREATE TABLE IF NOT EXISTS route_candidate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_route_geometry_id uuid NOT NULL UNIQUE REFERENCES source_route_geometry(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES source_registry(id) ON DELETE CASCADE,
  external_record_id text NOT NULL,
  route_code text,
  origin_rank_id uuid NOT NULL REFERENCES taxi_rank(id),
  destination_rank_id uuid NOT NULL REFERENCES taxi_rank(id),
  association_id uuid REFERENCES taxi_association(id),
  origin_distance_m numeric(10,2) NOT NULL,
  destination_distance_m numeric(10,2) NOT NULL,
  reconciliation_status text NOT NULL CHECK (reconciliation_status='exact_endpoint_pair'),
  verification_status verification_status NOT NULL DEFAULT 'documented',
  confidence numeric(5,4) NOT NULL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT route_candidate_distinct_endpoints CHECK (origin_rank_id <> destination_rank_id)
);

CREATE INDEX IF NOT EXISTS route_candidate_origin_idx ON route_candidate(origin_rank_id);
CREATE INDEX IF NOT EXISTS route_candidate_destination_idx ON route_candidate(destination_rank_id);
CREATE INDEX IF NOT EXISTS route_candidate_association_idx ON route_candidate(association_id);
CREATE INDEX IF NOT EXISTS route_candidate_source_idx ON route_candidate(source_id,external_record_id);

COMMIT;
