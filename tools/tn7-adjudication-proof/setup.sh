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
CREATE TABLE IF NOT EXISTS taxi_association (
  id uuid PRIMARY KEY,
  canonical_name text NOT NULL,
  acronym text,
  registration_number text,
  affiliation text,
  province text,
  district text,
  municipality text,
  address text,
  verification_status text NOT NULL DEFAULT 'unverified',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS taxi_rank (
  id uuid PRIMARY KEY,
  canonical_name text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  province text,
  district text,
  municipality text,
  suburb text,
  town text,
  address text,
  verification_status text NOT NULL DEFAULT 'unverified',
  updated_at timestamptz NOT NULL DEFAULT now()
);

TRUNCATE taxi_rank,taxi_association;

INSERT INTO taxi_rank (
  id,canonical_name,aliases,province,municipality,town,verification_status
) VALUES
('14141414-1414-4414-8414-141414141414','Central Taxi Rank',ARRAY['CTR','Central Rank'],'Gauteng','City A','Central','verified'),
('15151515-1515-4515-8515-151515151515','West Taxi Rank',ARRAY['West Rank'],'Gauteng','City B','West','verified'),
('16161616-1616-4616-8616-161616161616','North Taxi Rank',ARRAY[]::text[],'Gauteng','City C','North','verified'),
('17171717-1717-4717-8717-171717171717','South Taxi Rank',ARRAY[]::text[],'Gauteng','City D','South','verified'),
('18181818-1818-4818-8818-181818181818','East Taxi Rank',ARRAY[]::text[],'Gauteng','City E','East','verified'),
('19191919-1919-4919-8919-191919191919','Airport Taxi Rank',ARRAY[]::text[],'Gauteng','City F','Airport','verified');

INSERT INTO taxi_association (
  id,canonical_name,acronym,registration_number,province,municipality,verification_status
) VALUES
('21212121-2121-4212-8212-212121212121','Alpha Taxi Association','ATA','REG-ALPHA','Gauteng','City A','verified'),
('23232323-2323-4232-8232-232323232323','Beta Taxi Association','BTA','REG-BETA','Gauteng','City B','verified'),
('24242424-2424-4242-8242-242424242424','Gamma Taxi Association','GTA','REG-GAMMA','Gauteng','City C','verified');

TRUNCATE data_issue;
INSERT INTO data_issue (id,entity_type,issue_type,severity,summary,status) VALUES
('11111111-1111-4111-8111-111111111111','taxi_rank','proof_open','warning','Open proof issue','open'),
('22222222-2222-4222-8222-222222222222','taxi_rank','proof_reviewing','warning','Reviewing proof issue','reviewing'),
('33333333-3333-4333-8333-333333333333','taxi_rank','proof_atomic','warning','Atomic rollback proof issue','open'),
('44444444-4444-4444-8444-444444444444','taxi_rank','proof_concurrent','warning','Concurrent replay proof issue','open'),
('55555555-5555-4555-8555-555555555555','taxi_rank','proof_reject','warning','Reject proof issue','open'),
('66666666-6666-4666-8666-666666666666','taxi_rank','proof_reopen_defer','warning','Reopen deferred proof issue','reviewing'),
('77777777-7777-4777-8777-777777777777','taxi_rank','proof_reopen_reject','warning','Reopen rejected proof issue','open'),
('88888888-8888-4888-8888-888888888888','taxi_rank','proof_reject_atomic','warning','Reject rollback proof issue','open'),
('99999999-9999-4999-8999-999999999999','taxi_rank','proof_reopen_atomic','warning','Reopen rollback proof issue','open'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','taxi_rank','proof_dual_approve','warning','Dual-control approval proof issue','open'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','taxi_rank','proof_dual_self','warning','Self-approval denial proof issue','open'),
('cccccccc-cccc-4ccc-8ccc-cccccccccccc','taxi_rank','proof_dual_stale','warning','Stale proposal proof issue','open'),
('dddddddd-dddd-4ddd-8ddd-dddddddddddd','taxi_rank','proof_dual_reject','warning','Proposal reject proof issue','open'),
('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','taxi_rank','proof_dual_withdraw','warning','Proposal withdraw proof issue','reviewing'),
('ffffffff-ffff-4fff-8fff-ffffffffffff','taxi_rank','proof_dual_atomic','warning','Proposal approval rollback proof issue','open'),
('12121212-1212-4212-8212-121212121212','taxi_rank','proof_dual_concurrent','warning','Concurrent dual-approval proof issue','open'),
('13131313-1313-4313-8313-131313131313','taxi_rank','proof_dual_idempotency_conflict','warning','Proposal idempotency conflict proof issue','open');
SQL
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /proof/005_operator_audit.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /proof/006_data_issue_rejected_status.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /proof/007_two_person_decision_proposals.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /proof/008_transport_entity_aliases.sql
echo "TN7_ADJ4_DB_SETUP_PASS"
sleep 8
