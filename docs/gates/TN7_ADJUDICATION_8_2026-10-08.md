# TN7-ADJUDICATION-8 — Controlled Canonical Taxi-Association Merge Foundation

Date: 2026-10-08

## Verdict

**TN7_ADJ8 PASS**

Controlled canonical taxi-association merge is proven behind the existing ADJ3 two-person approval boundary.

Validated product implementation lineage:
- association-merge logic + API integration: `97d613de22bea066960e9fac09c70095dae7a207`
- disposable setup correction only: `fd92955b165f4ff7006a4b145655bc4de0b3fc6b`
- preview-guard test only: `0cd156dcb1fa5e13c5e78a8cb0d8231794a41658`

No product merge logic changed after `97d613de22bea066960e9fac09c70095dae7a207`.

Branch: `phase/tn7-transport-network-operations`

Draft PR: `#10 — TN7: Transport Network Operations & Data Completion foundation`

## Delivered

ADJ8 adds:
- migration `db/012_taxi_association_merge_foundation.sql`;
- durable association tombstone state;
- immutable merged-association trigger;
- durable `taxi_association_merge_lineage`;
- protected `POST /api/v1/operator/proposals/association-merges`;
- ADJ3 two-person proposal/approval integration;
- default-off `OPERATOR_ASSOCIATION_MERGE_ENABLED`;
- association-pair PostgreSQL advisory locking;
- frozen affected-graph SHA-256 stale-state protection;
- registration/legal identity conflict rejection;
- canonical-name/acronym/alias/promoted-alias collision rejection;
- promoted rank-association lineage fail-closed protection;
- projected duplicate canonical-route rejection;
- safe alias/acronym transfer into survivor aliases;
- safe canonical rank-association collapse/redirection;
- safe canonical route association redirection;
- active association issue redirection only;
- resolved/rejected historical issues preserved on duplicate tombstone;
- source evidence preserved on duplicate tombstone;
- operational association list/map/detail tombstone filtering;
- canonical merge audit + proposal approval audit in one transaction.

## Static acceptance

Service: `tn7-adj8-static-check`

Current-head static deployment:
`f1925798-0df0-4028-9c24-39ca1dc78ce2`

Result:

**TN7_ADJ8_STATIC_PASS 30/30**

## PostgreSQL migration proof

GitHub Transport Foundation migration run:
`37757658097` — `postgis-migrations` **SUCCESS**

Disposable PostGIS:
`tn7-adj8-db`

Clean setup deployment:
`f37b8838-3316-4d6d-9795-31922f918765`

Result:

**TN7_ADJ8_DB_SETUP_PASS**

Fresh disposable schema successfully applied:

`001 → 002 → 003 → 004 → 005 → 006 → 007 → 008 → 009 → 010 → 011 → 012`

No production PostGIS migration was executed.

## Isolated runtime API

Service:
`tn7-adj8-api`

Successful deployment:
`24c16ac7-2b04-4a5d-9ed4-46bac7ae9910`

Enabled only in this disposable runtime:
- `OPERATOR_DUAL_CONTROL_ENABLED=true`
- `OPERATOR_ASSOCIATION_MERGE_ENABLED=true`

## Runtime acceptance

Service:
`tn7-adj8-smoke`

Deployment:
`7b587ef3-788a-4b73-8a2a-31fc69f6447f`

Result:

**TN7_ADJ8_RUNTIME_PASS**

Proven:
- anonymous proposal rejected;
- same association rejected;
- conflicting registration identifiers rejected;
- third-party identity collision rejected;
- projected duplicate canonical route rejected;
- independent two-person approval;
- duplicate becomes immutable survivor-linked tombstone;
- safe identity transfer;
- relationship overlap collapse + relationship redirect;
- canonical route redirect;
- active issue redirect;
- resolved historical issue stays anchored to tombstone;
- source evidence stays anchored to tombstone;
- durable merge lineage;
- canonical merge audit exactly once;
- tombstone hidden from operational association list/detail;
- idempotent approval replay;
- tombstone UPDATE/DELETE blocked;
- stale graph blocks approval;
- concurrent same-pair proposals serialize to one winner.

## Atomic rollback

Forced final approval-audit failure proved rollback of:
- tombstone marking;
- relationship redirect;
- route redirect;
- active issue redirect;
- merge-lineage insert;
- canonical merge audit;
- proposal approval state.

**TN7_ADJ8_ATOMIC_MERGE_ROLLBACK_PASS**

**TN7_ADJ8_AUDIT_SEQUENCE_PASS 8**

## Normal preview guard

Preview API deployment:
`a3da72be-3d72-4b10-b4ea-f8b46040e9e6`

Preview Web deployment:
`980d1af1-2cb8-4ed6-bbef-154f5130ae83`

Preview guard deployment:
`ddb69bbb-f299-4e4a-8735-326efe8e134c`

Result:

**TN7_ADJ8_PREVIEW_GUARD_PASS**

Proof:
- association merge proposal → `503 association_merge_disabled`;
- proposal approval → `503 dual_control_disabled`;
- operator mutation capability disabled;
- association merge capability absent;
- public Web association-merge POST → 405;
- public Web proposal GET → 404;
- association feed healthy;
- counts unchanged:
  - ranks: **744**
  - associations: **35**
  - routes: **1,761**
  - rank-association candidates: **29**

## Production safety

Production transport API remains on:
`78ce2a643fea61a401d1a79fa69bc3ccc9cda33f`

Production API deployment:
`84df9a55-f1cf-4214-9b50-a762cadaeaea`

Migration 012 is not applied to production PostGIS.

No production association was merged, tombstoned, redirected or deleted.

PR #10 remains open, draft and unmerged.

**NO PRODUCTION MUTATION**

**MIGRATION 012 NOT APPLIED TO PRODUCTION**

**ASSOCIATION MERGE DISABLED IN PRODUCTION**

**PR #10 REMAINS DRAFT**

## Scope boundary

ADJ8 merges canonical taxi associations only.

It does not merge routes or ranks and does not automatically choose a survivor.
