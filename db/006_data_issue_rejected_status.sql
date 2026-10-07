BEGIN;

ALTER TABLE data_issue
  DROP CONSTRAINT IF EXISTS data_issue_status_check;

ALTER TABLE data_issue
  ADD CONSTRAINT data_issue_status_check
  CHECK (status IN ('open','reviewing','resolved','deferred','rejected'));

COMMIT;
