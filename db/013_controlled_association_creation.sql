BEGIN;

ALTER TABLE operator_decision_proposal
  ALTER COLUMN target_entity_id DROP NOT NULL;

ALTER TABLE operator_decision_proposal
  DROP CONSTRAINT IF EXISTS proposal_target_identity_consistent;

ALTER TABLE operator_decision_proposal
  ADD CONSTRAINT proposal_target_identity_consistent CHECK (
    (
      action='taxi_association.create'
      AND target_entity_type='taxi_association'
      AND target_entity_id IS NULL
    )
    OR
    (
      action<>'taxi_association.create'
      AND target_entity_id IS NOT NULL
    )
  );

COMMIT;
