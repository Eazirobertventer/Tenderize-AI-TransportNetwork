CREATE TABLE IF NOT EXISTS source_route_geometry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES source_registry(id) ON DELETE CASCADE,
  external_record_id text NOT NULL,
  route_code text,
  province text,
  municipality text,
  district text,
  category text,
  map_title text,
  geometry geometry(MultiLineString,4326) NOT NULL,
  verification_status verification_status NOT NULL DEFAULT 'documented',
  source_date timestamptz,
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  promoted_route_id uuid REFERENCES taxi_route(id),
  UNIQUE (source_id,external_record_id)
);

CREATE INDEX IF NOT EXISTS source_route_geometry_gix
  ON source_route_geometry USING gist (geometry);
CREATE INDEX IF NOT EXISTS source_route_geometry_route_code_idx
  ON source_route_geometry (route_code);
CREATE INDEX IF NOT EXISTS source_route_geometry_region_idx
  ON source_route_geometry (province,municipality,district);
