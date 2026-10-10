# TN7-ADJUDICATION-1 — Audit Migration & First Controlled Decision Action

Date: 2026-10-07

## Verdict

**PASS — first controlled adjudication action is proven in an isolated mutation environment.**

The action implemented is:

`POST /api/v1/operator/adjudications/data-issues/:id/defer`

The ordinary TN7 preview and TN6 production remain mutation-disabled.

## Safety model

The defer action requires all of the following:

- trusted operator JWT;
- role: `approver` or `admin`;
- `Idempotency-Key` header;
- rationale between 10 and 2,000 characters;
- caller-declared `expectedStatus` of `open` or `reviewing`;
- server-side issue row lock;
- environment kill switch `OPERATOR_DEFER_ISSUE_ENABLED=true`.

Default configuration is:

`OPERATOR_DEFER_ISSUE_ENABLED=false`

The public Web does not proxy adjudication routes.

## Transaction contract

The action executes inside one PostgreSQL transaction:

1. check prior audit event for the actor/action/idempotency key;
2. lock the target `data_issue` with `FOR UPDATE`;
3. re-check idempotency after lock;
4. reject stale expected state;
5. change issue status to `deferred`;
6. append immutable operator audit event with:
   - actor;
   - role;
   - before state;
   - after state;
   - evidence;
   - rationale;
   - request ID;
   - idempotency key;
7. commit.

Any audit-write failure rolls back the issue update.

## Static gate

Service:

`tn7-adj1-static-check`

Deployment:

`e535e57b-6f16-487e-9370-878c75d9e816`

Result:

**TN7_ADJ1_STATIC_PASS 13/13**

Proven statically:

- defer audit action exists;
- default-off kill switch exists;
- issue row uses `FOR UPDATE`;
- explicit BEGIN/COMMIT/ROLLBACK boundaries exist;
- idempotency key is mandatory;
- rationale is mandatory;
- expected status is mandatory;
- stale state is rejected;
- audit append is part of the action;
- approver/admin role is required;
- auth capability exposes the kill switch;
- audit immutability remains in migration 005;
- public Web does not proxy adjudications.

## Exact migration proof

Disposable Postgres:

`tn7-adj1-db`

Exact committed migration applied:

`db/005_operator_audit.sql`

Migration/setup runner:

`tn7-adj1-db-setup`

Deployment:

`92b7e600-9531-4bf6-8c3e-c4928dc04963`

Result:

**TN7_ADJ1_DB_SETUP_PASS**

The Docker proof image copied the committed migration file directly from the repository and executed it with `psql -v ON_ERROR_STOP=1`.

Migration 005 was **not** applied to production PostGIS.

## Isolated mutation API

Service:

`tn7-adj1-api`

Deployment:

`a85d6218-cef4-446a-b829-ee20d53428b4`

Status:

**SUCCESS**

The service used:

- disposable database only;
- dedicated proof JWT secret/issuer/audience;
- `OPERATOR_DEFER_ISSUE_ENABLED=true`.

## Runtime adjudication proof

Service:

`tn7-adj1-smoke`

Successful deployment:

`b2b204a3-284d-4aae-851d-54a732df0d00`

Result:

**TN7_ADJ1_RUNTIME_PASS**

### Access/control proof

- anonymous defer → **401**
- reviewer defer → **403**
- missing idempotency key → **400**
- short rationale → **400**
- missing expected status → **400**
- approver defer from `open` → **200**
- admin defer from `reviewing` → **200**

### Audit proof

For the first approver decision:

- issue moved from `open` → `deferred`;
- exactly one audit event was written;
- audit actor subject came from the trusted JWT;
- audit role was `approver`;
- action was `data_issue.defer`;
- before/after states were retained;
- rationale was retained.

Database trigger proof:

- audit UPDATE → blocked;
- audit DELETE → blocked.

### Idempotency/replay proof

Same actor + action + idempotency key replay:

- returns success with `replay:true`;
- writes no second audit event;
- does not mutate the issue twice.

A different idempotency key with stale `expectedStatus=open` after the issue was already deferred:

- returns **409**;
- writes no audit event.

### Concurrent duplicate proof

Two concurrent requests with the same actor/idempotency key were issued against one open issue.

Result:

- both requests returned success;
- exactly one request performed the mutation;
- exactly one request returned replay;
- exactly one audit event exists;
- issue is deferred once.

### Atomic rollback proof

The disposable audit table was deliberately given a temporary CHECK constraint that rejects new `data_issue.defer` audit inserts.

A valid defer request then:

1. locked and attempted to update the issue;
2. failed on audit insertion;
3. returned server error;
4. rolled the transaction back.

Proof markers:

- **TN7_ADJ1_ATOMIC_ROLLBACK_PASS**
- target issue remained `open`;
- no audit event was left behind.

Final disposable issue state:

- deferred: **3**
- open: **1** — the induced audit-failure rollback case.

## Production / preview status

No production canonical data was mutated.

The ordinary TN7 API preview must keep:

`OPERATOR_DEFER_ISSUE_ENABLED=false`

or omit the variable entirely.

Migration 005 remains unapplied to production PostGIS.

## Next recommended gate

**TN7-ADJUDICATION-2 — Controlled Reject + Reopen/Undefer Semantics**

Before merge/alias/approve operations, extend the same transaction/audit/idempotency pattern to:

- reject a candidate or issue with explicit evidence/rationale;
- define controlled reopen/undefer semantics;
- prove state-transition matrix;
- enforce two-person approval where canonical entity ownership would change.

Canonical merge/alias/ownership operations should remain later gates because they have materially higher blast radius.
