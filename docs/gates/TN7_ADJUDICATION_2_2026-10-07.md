# TN7-ADJUDICATION-2 — Controlled Reject + Reopen / Undefer

Date: 2026-10-07

## Verdict

**PASS — controlled reject and audit-linked reopen/undefer are proven in an isolated mutation environment.**

Validated code head before this evidence commit:

`972e9517b02f52bcd07f148e598ff36b37ab1240`

Branch:

`phase/tn7-transport-network-operations`

Draft PR:

`#10 — TN7: Transport Network Operations & Data Completion foundation`

## Delivered state transitions

### Reject

Endpoint:

`POST /api/v1/operator/adjudications/data-issues/:id/reject`

Allowed current states:

- `open`
- `reviewing`
- `deferred`

Result:

`rejected`

Reject requires:

- trusted operator JWT;
- `approver` or `admin`;
- `Idempotency-Key`;
- rationale;
- non-empty evidence object;
- expected current status;
- `OPERATOR_REJECT_ISSUE_ENABLED=true`.

A rejected issue receives a server-side `resolved_at` timestamp.

### Reopen / Undefer

Endpoint:

`POST /api/v1/operator/adjudications/data-issues/:id/reopen`

Allowed current states:

- `deferred`
- `rejected`

Reopen requires:

- trusted operator JWT;
- `approver` or `admin`;
- `Idempotency-Key`;
- rationale;
- expected current status;
- exact `priorAuditEventId`;
- `OPERATOR_REOPEN_ISSUE_ENABLED=true`.

The caller does **not** choose the target state.

The API restores the exact prior status from the referenced audit event's `before_state.status`, limited to:

- `open`
- `reviewing`

This means:

- open → rejected → reopen restores **open**;
- reviewing → deferred → reopen restores **reviewing**.

## Reversal lineage safeguards

A reopen request must prove all of the following:

1. referenced audit event belongs to the same data issue;
2. referenced action is `data_issue.defer` or `data_issue.reject`;
3. referenced event is the **latest status-changing adjudication event** for that issue;
4. referenced event's `after_state.status` equals the issue's current status;
5. referenced event's `before_state.status` is a safe restore state.

Older superseded defer/reject events cannot be reused to reverse a newer decision.

## Migration 006

Committed migration:

`db/006_data_issue_rejected_status.sql`

Changes:

- extends `data_issue.status` CHECK constraint with explicit `rejected`;
- adds append-only audit `event_sequence bigint GENERATED ALWAYS AS IDENTITY`;
- adds unique event-sequence index;
- adds entity + sequence index for deterministic adjudication ordering.

The monotonic sequence is used instead of timestamps for determining the latest reversible decision.

## Kill switches

Default configuration remains fail closed:

```
OPERATOR_DEFER_ISSUE_ENABLED=false
OPERATOR_REJECT_ISSUE_ENABLED=false
OPERATOR_REOPEN_ISSUE_ENABLED=false
```

The normal TN7 preview has none of these variables configured.

## Static gate

Service:

`tn7-adj2-static-check`

Deployment:

`9102983a-489a-43c2-9827-d0187705215a`

Result:

**TN7_ADJ2_STATIC_PASS 19/19**

Static assertions proved:

- explicit rejected status migration;
- monotonic audit sequence;
- audit sequence index;
- reject transaction;
- reopen transaction;
- reject/reopen audit actions;
- reject evidence requirement;
- prior audit requirement;
- latest-decision enforcement;
- audit ordering by sequence;
- prior after-state binding;
- safe restore-state guard;
- reject/reopen kill switches;
- auth capability exposure;
- public Web exclusion;
- approver/admin enforcement.

## Exact migration proof

Disposable database:

`tn7-adj2-db`

Setup service:

`tn7-adj2-db-setup`

Deployment:

`cf23312d-d7d2-4eec-851a-fd358ef9faf4`

Result:

**TN7_ADJ2_DB_SETUP_PASS**

The setup runner applied the exact committed migrations in order:

1. `db/005_operator_audit.sql`
2. `db/006_data_issue_rejected_status.sql`

No production PostGIS migration was executed.

## Isolated mutation API

Service:

`tn7-adj2-api`

Deployment:

`7ebf2c25-cc23-4729-bad9-7c364a37f23b`

Status:

**SUCCESS**

Only this disposable API enabled:

- defer;
- reject;
- reopen.

## Runtime proof

Service:

`tn7-adj2-smoke`

Deployment:

`77895a7a-d0a0-429e-8588-bb74e701ee76`

Result:

**TN7_ADJ2_RUNTIME_PASS**

### Reject proof

- anonymous reject → **401**
- reviewer reject → **403**
- reject without evidence → **400**
- approver open → rejected → **200**
- rejected issue gets `resolved_at`;
- exactly one reject audit event;
- before/after status preserved;
- reject evidence preserved;
- same idempotency key replays safely;
- replay creates no second audit row.

### Reopen rejected issue proof

An admin reopened the rejected issue using the exact reject audit ID.

Result:

- rejected → **open**
- `resolved_at` cleared;
- reopen audit event created;
- reopen metadata references the reversed reject audit event;
- before/after state preserved.

### Undefer proof

A `reviewing` issue was deferred, then reopened.

Result:

- reviewing → deferred;
- reopen restored **reviewing**, not an arbitrary caller-selected state.

Two concurrent reopen requests using the same actor/idempotency key:

- both returned success;
- exactly one performed the mutation;
- exactly one returned replay;
- exactly one reopen audit row exists.

### Superseded audit protection

Proof sequence:

1. reject issue;
2. reopen it;
3. reject it again;
4. attempt reopen using the **first**, superseded reject audit ID.

Result:

- request → **409 prior_adjudication_not_latest**
- issue remained rejected.

Reopen using the second/latest reject audit ID then succeeded.

### Reject atomic rollback

A temporary disposable CHECK constraint was added to force `data_issue.reject` audit inserts to fail.

Result:

- reject request returned server failure;
- issue remained `open`;
- no reject audit row remained.

Proof marker:

**TN7_ADJ2_REJECT_ATOMIC_ROLLBACK_PASS**

### Reopen atomic rollback

A separate disposable CHECK constraint forced `data_issue.reopen` audit inserts to fail.

Result:

- reopen request returned server failure;
- issue remained `deferred`;
- no reopen audit row remained.

Proof marker:

**TN7_ADJ2_REOPEN_ATOMIC_ROLLBACK_PASS**

### Audit ordering proof

All generated audit events were checked for strictly increasing `event_sequence`.

Result:

**TN7_ADJ2_AUDIT_SEQUENCE_PASS 9**

## Normal preview fail-closed proof

TN7 API preview deployment:

`7e79d804-c4b7-492b-aaf0-7ee5b389736c`

TN7 Web preview deployment:

`d40e8d76-fe8e-48fd-8319-f991a2ecb71a`

Both are **SUCCESS** on the ADJ2 code head.

The preview API has no defer/reject/reopen kill-switch variables.

Guard service:

`tn7-adj2-preview-guard`

Deployment:

`fb347b9f-e22c-48f2-aef8-6cd0e3a179a9`

Result:

**TN7_ADJ2_PREVIEW_GUARD_PASS**

Proof:

- valid approver reject → **503 adjudication_reject_disabled**
- valid approver reopen → **503 adjudication_reopen_disabled**
- operator capabilities report mutation disabled with zero enabled actions;
- public Web adjudication POST → **405**;
- network inventory counts remained:
  - ranks: **744**
  - associations: **35**
  - routes: **1,761**
  - rank-association candidates: **29**

## Production status

**No production mutation.**

- migration 005 remains unapplied to production PostGIS;
- migration 006 remains unapplied to production PostGIS;
- TN6 production services remain unchanged;
- normal TN7 preview mutation switches remain disabled;
- all reject/reopen mutations occurred only in disposable Postgres.

## Next recommended gate

**TN7-ADJUDICATION-3 — Two-Person Approval Foundation for Canonical Promotions**

Do not move directly to merge/alias/association ownership with single-actor authority.

Recommended next gate:

- create a proposed-decision record rather than immediately mutating canonical entities;
- proposer and approver must be different trusted operator subjects;
- proposal stores intended mutation, evidence, rationale and canonical before-state hash;
- approver verifies the state has not changed since proposal;
- approval and canonical mutation execute atomically;
- replay/idempotency proof;
- self-approval denied;
- stale proposal denied;
- withdraw/reject proposal workflow;
- immutable audit linkage across propose → approve/reject → canonical mutation.

Only after that foundation passes should we activate alias promotion, association ownership assignment, route promotion or entity merge.
