# TN7-ADJUDICATION-3 — Two-Person Approval Foundation

Date: 2026-10-07

## Verdict

**PASS — reusable two-person proposal/approval control is proven in an isolated mutation environment.**

Validated implementation head before this evidence commit:

`df48b742dfd9b2910f280f1465ea4dd81c95d111`

Branch:

`phase/tn7-transport-network-operations`

Draft PR:

`#10 — TN7: Transport Network Operations & Data Completion foundation`

## Purpose

ADJ3 establishes dual control before higher-impact canonical operations such as:

- alias promotion;
- association ownership assignment;
- route promotion;
- entity merge.

The first executable proof action is deliberately limited to:

`data_issue.defer`

Direct one-person defer/reject/reopen paths remain separately controlled and were disabled throughout the ADJ3 runtime proof.

## Proposal lifecycle

New protected routes:

### Create proposal

`POST /api/v1/operator/proposals/data-issues/:id/defer`

Allowed roles:

- reviewer
- approver
- admin

Requirements:

- trusted operator JWT;
- idempotency key;
- rationale;
- non-empty evidence;
- expected issue state of `open` or `reviewing`;
- `OPERATOR_DUAL_CONTROL_ENABLED=true`.

Creating a proposal does **not** mutate the target issue.

### Read proposal

`GET /api/v1/operator/proposals/:proposalId`

Allowed roles:

- reviewer
- approver
- admin

### Approve proposal

`POST /api/v1/operator/proposals/:proposalId/approve`

Allowed roles:

- approver
- admin

Requirements:

- approver subject must differ from proposer subject;
- idempotency key;
- independent approval rationale;
- independent approval evidence;
- proposal must still be `proposed`;
- frozen before-state hash must still match the canonical entity;
- proposed action must be supported.

For the ADJ3 proof action, successful approval executes the proposed `data_issue.defer` mutation atomically.

### Reject proposal

`POST /api/v1/operator/proposals/:proposalId/reject`

Allowed roles:

- approver
- admin

Self-decision is denied.

Rejecting a proposal changes only proposal state. It does not mutate the target canonical entity.

### Withdraw proposal

`POST /api/v1/operator/proposals/:proposalId/withdraw`

Allowed actor:

- original proposer; or
- admin.

Withdrawal changes only proposal state.

## Migration 007

Committed migration:

`db/007_two_person_decision_proposals.sql`

Creates:

`operator_decision_proposal`

Frozen proposal fields include:

- proposed action;
- target entity type/id;
- intended change;
- canonical before-state;
- SHA-256 before-state hash;
- evidence;
- rationale;
- proposer subject/display name/role;
- proposal idempotency key;
- proposal timestamp.

Decision fields include:

- lifecycle status;
- decision actor;
- decision rationale/evidence;
- decision idempotency key;
- decision timestamp;
- canonical mutation audit-event link.

Lifecycle statuses:

- `proposed`
- `approved`
- `rejected`
- `withdrawn`

Database protections:

- proposal creation idempotency unique index;
- proposal decision idempotency unique index;
- target/status indexes;
- DELETE blocked by trigger;
- immutable proposal fields cannot be changed after creation.

Only lifecycle decision fields may change.

## Frozen before-state integrity

Proposal creation captures the complete data-issue state in canonical JSON form and calculates a SHA-256 hash.

Before approval:

1. target issue is locked;
2. current canonical state is re-read;
3. current SHA-256 is recalculated;
4. approval is rejected if it differs from the proposal hash.

The caller cannot update the proposal hash or frozen before-state.

## Atomic approval contract

A successful approval executes one PostgreSQL transaction:

1. lock proposal;
2. enforce different proposer/approver subjects;
3. lock canonical target issue;
4. verify frozen before-state hash;
5. execute proposed canonical mutation;
6. append canonical mutation audit event;
7. update proposal to `approved`;
8. link canonical audit event to proposal;
9. append proposal-approval audit event;
10. commit.

Any failure rolls back:

- canonical mutation;
- canonical mutation audit;
- proposal state change;
- proposal approval audit.

## Audit linkage

Proposal creation:

`decision_proposal.create`

Proposal approval:

`decision_proposal.approve`

Proposal rejection:

`decision_proposal.reject`

Proposal withdrawal:

`decision_proposal.withdraw`

Successful approved canonical action:

`data_issue.defer`

Canonical mutation audit metadata includes:

- `dualControl:true`;
- proposer subject;
- approver subject;
- proposal before-state hash.

The approved proposal stores the canonical audit event ID.

## Kill switch

Default:

`OPERATOR_DUAL_CONTROL_ENABLED=false`

Direct mutation kill switches remain independent:

```
OPERATOR_DEFER_ISSUE_ENABLED=false
OPERATOR_REJECT_ISSUE_ENABLED=false
OPERATOR_REOPEN_ISSUE_ENABLED=false
```

The ADJ3 proof environment enabled only dual control.

## Static gate

Service:

`tn7-adj3-static-check`

Deployment:

`77aad9be-c5f2-4f38-8a02-837edbf417be`

Result:

**TN7_ADJ3_STATIC_PASS 25/25**

Proven statically:

- proposal schema/lifecycle;
- frozen before-state hash;
- create/decision idempotency;
- deletion guard;
- immutable proposal fields;
- self-approval denial;
- stale-state rejection;
- canonical SHA-256 state hashing;
- dual-control defer action;
- proposal approve/reject/withdraw audits;
- explicit idempotency conflicts;
- lifecycle routes;
- dual-control kill switch;
- public Web exclusion;
- proposer/approver subject comparison;
- canonical audit-event linkage.

## Exact migration proof

Disposable database:

`tn7-adj3-db`

Setup service:

`tn7-adj3-db-setup`

Deployment:

`90b57ac2-69f7-46f9-8eb2-0a44a7c884d2`

Result:

**TN7_ADJ3_DB_SETUP_PASS**

The proof applied exact committed migrations in order:

1. `db/005_operator_audit.sql`
2. `db/006_data_issue_rejected_status.sql`
3. `db/007_two_person_decision_proposals.sql`

Seeded deterministic proof issues: **17**.

No production PostGIS migration was executed.

## Isolated dual-control API

Service:

`tn7-adj3-api`

Deployment:

`8487c2dd-df5b-4ea8-859b-01fab846c569`

Status:

**SUCCESS**

Configuration:

- `OPERATOR_DUAL_CONTROL_ENABLED=true`;
- direct defer switch absent/false;
- direct reject switch absent/false;
- direct reopen switch absent/false.

The runtime proof first confirmed that direct one-person defer remained disabled.

## Runtime dual-control proof

Service:

`tn7-adj3-smoke`

Successful deployment:

`90a42877-38e6-4ad1-b29a-f8ebdea89030`

Result:

**TN7_ADJ3_RUNTIME_PASS**

### Proposal creation

- anonymous proposal → **401**
- reviewer proposal → **201**
- proposal starts `proposed`;
- proposer identity frozen;
- SHA-256 before-state stored;
- canonical issue remains unchanged;
- authenticated proposal GET works;
- same creation idempotency key safely replays;
- same proposal key reused for a different target → **409 proposal_idempotency_key_conflict**.

### Self-approval denial

An Approver created a proposal and attempted to approve the same proposal.

Result:

**403 decision_proposal_self_approval_forbidden**

Canonical issue remained unchanged.

A second/different Approver could approve that proposal.

### Independent approval + canonical mutation

A Reviewer proposed a defer.

A different Approver approved it.

Result:

- proposal → `approved`;
- issue → `deferred`;
- proposer and approver subjects differ;
- exactly one canonical `data_issue.defer` audit exists;
- canonical audit attributed to approver;
- canonical audit marks `dualControl:true`;
- canonical audit stores proposer + approver subjects;
- proposal stores canonical mutation audit event ID;
- proposal creation and approval have their own immutable audit events.

### Approval replay

Same Approver + same approval idempotency key:

- returns success with replay;
- no second canonical mutation audit.

### Decision idempotency conflict

An Approver used a decision idempotency key on one proposal.

Reusing that key on another proposal:

**409 decision_idempotency_key_conflict**

### Stale proposal protection

A proposal was created from a valid canonical snapshot.

The issue summary was then changed directly in the disposable database.

Approval result:

**409 decision_proposal_stale_before_state**

- target status remained unchanged;
- proposal remained `proposed`.

### Proposal rejection

Independent Approver rejected a proposal.

Result:

- proposal → `rejected`;
- canonical issue remained `open`;
- rejected proposal could not later be approved.

### Proposal withdrawal

A Reviewer created a proposal.

A different Reviewer attempted withdrawal:

**403 decision_proposal_withdraw_forbidden**

Original proposer withdrew it successfully.

Result:

- proposal → `withdrawn`;
- target canonical issue remained unchanged.

### Concurrent approval proof

Two simultaneous approval requests used the same Admin and idempotency key.

Result:

- both returned safely;
- exactly one performed the canonical mutation;
- exactly one returned replay;
- exactly one canonical defer audit exists.

### Proposal database immutability proof

Direct SQL attempt to modify frozen proposal rationale:

**blocked**

Direct SQL attempt to DELETE proposal:

**blocked**

### Atomic approval rollback proof

A disposable CHECK constraint deliberately forced the final `decision_proposal.approve` audit insertion to fail after:

- canonical issue update attempt;
- canonical defer audit attempt;
- proposal approval update attempt.

Result:

- API returned server error;
- target issue rolled back to `open`;
- proposal rolled back to `proposed`;
- canonical defer audit rolled back;
- proposal approval audit absent.

Proof marker:

**TN7_ADJ3_ATOMIC_APPROVAL_ROLLBACK_PASS**

### Audit ordering

All audit events remained strictly monotonic by `event_sequence`.

Result:

**TN7_ADJ3_AUDIT_SEQUENCE_PASS 16**

Final disposable proposal distribution:

- approved: **3**
- proposed: **3**
- rejected: **1**
- withdrawn: **1**

Final disposable issue distribution:

- deferred: **3**
- open: **11**
- reviewing: **3**

## Normal preview fail-closed proof

TN7 API preview deployment:

`31446ab6-dbfd-466d-ad13-f0fac38654b4`

TN7 Web preview deployment:

`46fa3f05-b6de-4dfd-93e2-33fd516b2b56`

Both are **SUCCESS** on the ADJ3 implementation head.

Normal preview service variables contain none of:

- `OPERATOR_DEFER_ISSUE_ENABLED`
- `OPERATOR_REJECT_ISSUE_ENABLED`
- `OPERATOR_REOPEN_ISSUE_ENABLED`
- `OPERATOR_DUAL_CONTROL_ENABLED`

Preview guard:

`tn7-adj3-preview-guard`

Deployment:

`76bf878c-41c1-48bd-a648-31a0a052a984`

Result:

**TN7_ADJ3_PREVIEW_GUARD_PASS**

Proof:

- valid Reviewer proposal creation → **503 dual_control_disabled**
- valid Approver approval → **503 dual_control_disabled**
- operator capabilities report mutation disabled;
- zero enabled adjudication actions;
- public Web proposal POST → **405**
- public Web proposal GET → **404**
- network counts unchanged:
  - ranks: **744**
  - associations: **35**
  - routes: **1,761**
  - rank-association candidates: **29**

## Production status

**No production mutation.**

- migration 005 unapplied to production PostGIS;
- migration 006 unapplied to production PostGIS;
- migration 007 unapplied to production PostGIS;
- TN6 production services unchanged;
- normal TN7 preview dual-control disabled;
- all dual-control canonical mutations occurred only in disposable Postgres.

## Scope boundary

ADJ3 proves the reusable two-person foundation using only `data_issue.defer`.

The following remain unsupported and disabled:

- alias promotion;
- association ownership assignment;
- route candidate promotion;
- entity merge.

They must be added individually through later gates with action-specific integrity tests.

## Next recommended gate

**TN7-ADJUDICATION-4 — Controlled Alias Promotion**

Recommended first higher-impact dual-control operation:

- propose association/rank alias;
- freeze target canonical state and source evidence;
- different Approver required;
- duplicate/collision checks across canonical names and aliases;
- case/normalisation safety;
- proposal stale-state check;
- atomic alias mutation + canonical audit + proposal approval audit;
- rollback proof;
- self-approval denial;
- public preview default-off.

Alias promotion is lower blast-radius than association ownership or entity merge and is the safest first canonical identity mutation to place behind the ADJ3 dual-control foundation.
