#!/bin/bash
set -euo pipefail
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS data_issue (
  id uuid PRIMARY KEY,
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
TRUNCATE data_issue;
INSERT INTO data_issue (id,entity_type,issue_type,severity,summary,status) VALUES
('11111111-1111-4111-8111-111111111111','taxi_rank','proof_open','warning','Open proof issue','open'),
('22222222-2222-4222-8222-222222222222','taxi_rank','proof_reviewing','warning','Reviewing proof issue','reviewing'),
('33333333-3333-4333-8333-333333333333','taxi_rank','proof_atomic','warning','Atomic rollback proof issue','open'),
('44444444-4444-4444-8444-444444444444','taxi_rank','proof_concurrent','warning','Concurrent replay proof issue','open');
SQL
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /proof/005_operator_audit.sql
echo "TN7_ADJ1_DB_SETUP_PASS"
sleep 8
