# TN7-AUTH — Trusted Operator Identity Contract

## Purpose

TN7-AUTH establishes the fail-closed identity and authorisation boundary that must exist before any operator can approve, reject, merge, alias, defer or otherwise mutate canonical transport-network data.

This gate does **not** enable adjudication mutations.

## Token trust model

The Transport API accepts a short-lived signed Bearer JWT only on protected operator routes.

Required token properties:

- algorithm: `HS256` only;
- issuer: `OPERATOR_JWT_ISSUER` (default `tenderize-iam`);
- audience: `OPERATOR_JWT_AUDIENCE` (default `transport-network-operator`);
- subject: non-empty `sub`;
- expiry: finite `exp`, validated with bounded clock skew;
- optional `nbf` and `iat` are validated;
- at least one recognised operator role.

The API rejects:

- missing tokens;
- malformed tokens;
- invalid signatures;
- wrong issuer/audience;
- expired/not-yet-active tokens;
- tokens issued materially in the future;
- tokens with no recognised role;
- algorithms other than HS256.

The verification secret must be at least 32 bytes. If it is absent or too short, protected routes fail closed with `503 operator_auth_unconfigured`.

No secret is shipped to the browser and the Transport API does not expose a token-issuing endpoint.

## Roles

### reviewer
May:
- identify their operator session;
- read authenticated quality queues;
- inspect detailed data issues and reconciliation candidates.

May not:
- perform adjudication mutations.

### approver
Includes reviewer read access and is eligible for future adjudication mutation endpoints.

During TN7-AUTH, mutation calls still return `501 adjudication_not_enabled`.

### admin
Includes reviewer read access and is eligible for future administrative/adjudication actions.

During TN7-AUTH, mutations still remain disabled.

## Protected routes

### GET /api/v1/operator/me

Roles:
- reviewer
- approver
- admin

Returns the verified actor identity, role set and auth capabilities.

### GET /api/v1/operator/quality-queue

Roles:
- reviewer
- approver
- admin

Read-only response containing:
- aggregate quality summary;
- detailed data issues;
- rank ↔ association candidates;
- route candidates that do not yet have association ownership.

Response explicitly reports `mutationEnabled:false`.

### GET /api/v1/data-issues

Now requires a trusted operator token.

### GET /api/v1/reconciliation/rank-candidates

Now requires a trusted operator token.

### POST /api/v1/operator/adjudications/*

Roles:
- approver
- admin

TN7-AUTH behaviour:
- no token → 401;
- reviewer → 403;
- approver/admin → 501 `adjudication_not_enabled`.

This deliberately proves role enforcement without allowing a database mutation.

## Public Web boundary

The public Web proxy does **not** allow-list `/api/v1/operator/*`, `/api/v1/data-issues` or `/api/v1/reconciliation/rank-candidates`.

Public users therefore receive 404 at the Web boundary before requests reach the protected API.

The public Web also remains GET/HEAD-only.

## Audit foundation

Migration `db/005_operator_audit.sql` creates `operator_audit_event`.

Properties:
- actor subject/display name/role;
- action;
- target entity type/id;
- request ID;
- optional idempotency key;
- before and after state;
- evidence reviewed;
- rationale;
- metadata;
- server timestamp.

The table is append-only:
- UPDATE is rejected by a database trigger;
- DELETE is rejected by the same trigger;
- idempotency keys can be made unique per actor/action.

The migration is additive and is **not** run by application startup.

TN7-AUTH preview validation must not apply it to production.

## Future TN7-ADJUDICATION activation requirements

Before mutation is enabled:

1. apply/review the audit migration in a controlled database gate;
2. require approver/admin role at each mutation boundary;
3. require a rationale for canonical changes;
4. require idempotency key for mutation requests;
5. write audit event atomically with the canonical change;
6. record before/after state and evidence references;
7. prove duplicate mutation replay is safe;
8. prove cross-entity integrity and tenant/operator isolation;
9. keep public Web mutation paths blocked unless an authenticated operator application is explicitly introduced.
