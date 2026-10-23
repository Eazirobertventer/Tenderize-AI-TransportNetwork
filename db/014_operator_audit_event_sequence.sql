BEGIN;

ALTER TABLE operator_audit_event
  ADD COLUMN IF NOT EXISTS event_sequence bigserial;

CREATE UNIQUE INDEX IF NOT EXISTS operator_audit_event_sequence_unique
  ON operator_audit_event (event_sequence);

ALTER TABLE operator_audit_event
  ALTER COLUMN event_sequence SET NOT NULL;

COMMIT;
