BEGIN;

ALTER TABLE taxi_association
  ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION normalize_transport_identity_name(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT lower(regexp_replace(btrim(value), '\s+', ' ', 'g'));
$$;

CREATE TABLE IF NOT EXISTS transport_entity_alias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('taxi_rank','taxi_association')),
  entity_id uuid NOT NULL,
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  promoted_by_proposal_id uuid NOT NULL REFERENCES operator_decision_proposal(id),
  promoted_audit_event_id uuid NOT NULL REFERENCES operator_audit_event(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (alias=btrim(alias)),
  CHECK (char_length(alias) BETWEEN 2 AND 200),
  CHECK (normalized_alias=normalize_transport_identity_name(alias))
);

CREATE UNIQUE INDEX IF NOT EXISTS transport_entity_alias_normalized_unique
  ON transport_entity_alias (entity_type,normalized_alias);

CREATE UNIQUE INDEX IF NOT EXISTS transport_entity_alias_entity_normalized_unique
  ON transport_entity_alias (entity_type,entity_id,normalized_alias);

CREATE INDEX IF NOT EXISTS transport_entity_alias_entity_idx
  ON transport_entity_alias (entity_type,entity_id,created_at DESC);

COMMIT;
