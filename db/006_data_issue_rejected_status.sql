BEGIN;

ALTER TABLE data_issue
  DROP CONSTRAINT IF EXISTS data_issue_status_check;

ALTER TABLE data_issue
  ADD CONSTRAINT data_issue_status_check
  CHECK (status IN ('open','reviewing','resolved','deferred','rejected'));

ALTER TABLE operator_audit_event
  ADD COLUMN IF NOT EXISTS event_sequence bigint GENERATED ALWAYS AS IDENTITY;

CREATE UNIQUE INDEX IF NOT EXISTS operator_audit_event_sequence_idx
  ON operator_audit_event (event_sequence);

CREATE INDEX IF NOT EXISTS operator_audit_event_entity_sequence_idx
  ON operator_audit_event (entity_type,entity_id,event_sequence DESC);

COMMIT;
