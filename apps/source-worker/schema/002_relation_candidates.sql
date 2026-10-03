BEGIN;

CREATE TABLE rank_association_candidate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES source_registry(id) ON DELETE CASCADE,
  source_rank_external_id text NOT NULL,
  taxi_rank_id uuid REFERENCES taxi_rank(id) ON DELETE CASCADE,
  association_label text NOT NULL,
  normalized_label text NOT NULL,
  verification_status verification_status NOT NULL DEFAULT 'documented',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, source_rank_external_id, normalized_label)
);

CREATE INDEX rank_association_candidate_rank_idx
  ON rank_association_candidate (taxi_rank_id);

CREATE TABLE rank_destination_candidate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES source_registry(id) ON DELETE CASCADE,
  source_rank_external_id text NOT NULL,
  taxi_rank_id uuid REFERENCES taxi_rank(id) ON DELETE CASCADE,
  destination_label text NOT NULL,
  normalized_label text NOT NULL,
  verification_status verification_status NOT NULL DEFAULT 'documented',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, source_rank_external_id, normalized_label)
);

CREATE INDEX rank_destination_candidate_rank_idx
  ON rank_destination_candidate (taxi_rank_id);

COMMIT;
