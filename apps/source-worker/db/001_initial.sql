BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE verification_status AS ENUM (
  'official',
  'verified',
  'documented',
  'community_verified',
  'candidate',
  'inferred',
  'conflict',
  'unverified'
);

CREATE TYPE source_class AS ENUM (
  'official_gis',
  'nltis_olas',
  'municipal_itp',
  'provincial_transport',
  'santaco',
  'nta',
  'google_places',
  'openstreetmap',
  'community',
  'commercial_directory',
  'inferred'
);

CREATE TABLE source_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text UNIQUE NOT NULL,
  source_name text NOT NULL,
  authority text,
  source_class source_class NOT NULL,
  source_url text,
  coverage text,
  licence_note text,
  official boolean NOT NULL DEFAULT false,
  legacy boolean NOT NULL DEFAULT false,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE taxi_association (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text NOT NULL,
  acronym text,
  registration_number text,
  affiliation text,
  province text,
  district text,
  municipality text,
  address text,
  location geometry(Point, 4326),
  phone text[],
  email text[],
  verification_status verification_status NOT NULL DEFAULT 'unverified',
  confidence numeric(5,4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX taxi_association_registration_unique
  ON taxi_association (registration_number)
  WHERE registration_number IS NOT NULL;
CREATE INDEX taxi_association_name_trgm_idx
  ON taxi_association USING gin (canonical_name gin_trgm_ops);
CREATE INDEX taxi_association_location_gix
  ON taxi_association USING gist (location);

CREATE TABLE taxi_rank (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  province text,
  district text,
  municipality text,
  suburb text,
  town text,
  address text,
  rank_type text,
  ownership text,
  formal_status text,
  service_types text[] NOT NULL DEFAULT '{}',
  google_place_id text,
  location geometry(Point, 4326),
  verification_status verification_status NOT NULL DEFAULT 'unverified',
  confidence numeric(5,4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX taxi_rank_google_place_unique
  ON taxi_rank (google_place_id)
  WHERE google_place_id IS NOT NULL;
CREATE INDEX taxi_rank_name_trgm_idx
  ON taxi_rank USING gin (canonical_name gin_trgm_ops);
CREATE INDEX taxi_rank_location_gix
  ON taxi_rank USING gist (location);
CREATE INDEX taxi_rank_region_idx
  ON taxi_rank (province, municipality, town);

CREATE TABLE taxi_rank_association (
  taxi_rank_id uuid NOT NULL REFERENCES taxi_rank(id) ON DELETE CASCADE,
  association_id uuid NOT NULL REFERENCES taxi_association(id) ON DELETE CASCADE,
  verification_status verification_status NOT NULL DEFAULT 'unverified',
  confidence numeric(5,4),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (taxi_rank_id, association_id)
);

CREATE TABLE taxi_route (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_id uuid REFERENCES taxi_association(id),
  origin_rank_id uuid REFERENCES taxi_rank(id),
  destination_rank_id uuid REFERENCES taxi_rank(id),
  origin_label text,
  destination_label text,
  route_name text,
  national_route_code text,
  board_route_code text,
  route_type text,
  street_description text,
  geometry geometry(MultiLineString, 4326),
  geometry_status text NOT NULL DEFAULT 'pending',
  distance_km numeric(12,3),
  duration_minutes integer,
  verification_status verification_status NOT NULL DEFAULT 'unverified',
  confidence numeric(5,4),
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT route_endpoints_present CHECK (
    origin_rank_id IS NOT NULL OR origin_label IS NOT NULL
  ),
  CONSTRAINT route_destination_present CHECK (
    destination_rank_id IS NOT NULL OR destination_label IS NOT NULL
  ),
  CONSTRAINT inferred_geometry_guard CHECK (
    NOT (verification_status = 'official' AND geometry_status IN ('inferred', 'straight_line_demo_only'))
  )
);

CREATE INDEX taxi_route_geometry_gix ON taxi_route USING gist (geometry);
CREATE INDEX taxi_route_origin_idx ON taxi_route (origin_rank_id);
CREATE INDEX taxi_route_destination_idx ON taxi_route (destination_rank_id);
CREATE INDEX taxi_route_association_idx ON taxi_route (association_id);
CREATE INDEX taxi_route_codes_idx ON taxi_route (national_route_code, board_route_code);

CREATE TABLE source_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES source_registry(id),
  entity_type text NOT NULL CHECK (entity_type IN ('taxi_rank','taxi_association','taxi_route','rank_association')),
  entity_id uuid NOT NULL,
  external_record_id text,
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_geometry geometry(Geometry, 4326),
  source_retrieved_at timestamptz NOT NULL DEFAULT now(),
  source_last_checked_at timestamptz,
  source_confidence numeric(5,4),
  checksum text,
  UNIQUE (source_id, entity_type, external_record_id)
);

CREATE INDEX source_record_entity_idx ON source_record (entity_type, entity_id);
CREATE INDEX source_record_payload_gin ON source_record USING gin (source_payload);

CREATE TABLE data_issue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid,
  issue_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info','warning','error','blocking')),
  summary text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','resolved','deferred')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE ingestion_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES source_registry(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL CHECK (status IN ('running','success','failed','partial')),
  records_seen integer NOT NULL DEFAULT 0,
  records_created integer NOT NULL DEFAULT 0,
  records_updated integer NOT NULL DEFAULT 0,
  records_quarantined integer NOT NULL DEFAULT 0,
  error_summary jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE MATERIALIZED VIEW rank_connectivity AS
SELECT
  r.id AS rank_id,
  r.canonical_name,
  count(DISTINCT tr.id) FILTER (WHERE tr.origin_rank_id = r.id OR tr.destination_rank_id = r.id) AS route_count,
  count(DISTINCT tr.association_id) AS association_count
FROM taxi_rank r
LEFT JOIN taxi_route tr
  ON tr.origin_rank_id = r.id OR tr.destination_rank_id = r.id
GROUP BY r.id, r.canonical_name;

CREATE UNIQUE INDEX rank_connectivity_rank_unique ON rank_connectivity(rank_id);

COMMIT;
