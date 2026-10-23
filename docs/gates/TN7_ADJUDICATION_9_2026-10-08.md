# TN7-ADJUDICATION-9 — Integrated Adjudication Workbench Runtime & Operator Acceptance

Date: 2026-10-08

## Verdict

**TN7_ADJ9 PASS**

ADJ1 through ADJ8 are now integrated into one private authenticated operator workbench and have passed static, isolated runtime, operator-flow and normal-preview fail-closed acceptance.

Product implementation head:

`bf20f3644515a07e432ec96f1a5a43c1d81b13bf`

Preview-guard test head:

`ba6b06b544265078abe4ccb97e91ec8dcc805439`

Branch:

`phase/tn7-transport-network-operations`

Draft PR:

`#10 — TN7: Transport Network Operations & Data Completion foundation`

## Delivered

### Authenticated workbench API

New protected endpoint:

`GET /api/v1/operator/workbench`

Roles:

- reviewer;
- approver;
- admin.

The response combines:

- operator identity and adjudication capabilities;
- ADJ1–ADJ8 action catalogue;
- data-quality issue queue;
- rank-association candidates;
- route candidates;
- pending proposals;
- recent proposals/decisions;
- recent immutable audit events;
- operational summary counts.

### Schema compatibility

Normal TN7 preview intentionally does not carry migrations 005–012.

The workbench now checks the adjudication schema before reading it.

If the required schema is absent:

`503 operator_workbench_schema_unavailable`

with:

`mutationEnabled:false`

This prevents a 500 and keeps the preview fail closed.

### Private operator application

New application:

`apps/operator-workbench`

The workbench is default-off:

`OPERATOR_WORKBENCH_ENABLED !== true`

means the UI is not served.

The private proxy has an explicit allowlist and preserves:

- Bearer authorization;
- Idempotency-Key;
- content type.

It does not create a generic transport API proxy.

The public TN7 Web remains separate and does not proxy the workbench.

### Integrated controlled actions

The workbench surfaces:

- ADJ1 — defer issue;
- ADJ2 — reject issue;
- ADJ2 — reopen / undefer;
- ADJ4 — rank alias promotion;
- ADJ4 — association alias promotion;
- ADJ5 — operating-association assignment;
- ADJ6 — route candidate promotion;
- ADJ7 — canonical rank merge;
- ADJ8 — canonical association merge.

Direct ADJ1/ADJ2 actions remain Approver/Admin controlled by the API.

ADJ4–ADJ8 continue to use the existing two-person proposal boundary.

The workbench does not weaken or duplicate authorization logic.

## Static acceptance

Service:

`tn7-adj9-static-check`

Deployment:

`f4bffd02-36ea-47ef-b403-66231cfdcbb2`

Result:

**TN7_ADJ9_STATIC_PASS 39/39**

Static proof includes:

- authenticated workbench contract;
- adjudication-schema availability guard;
- all ADJ1–ADJ8 actions surfaced;
- queues, proposals and immutable audit view;
- default-off operator UI;
- explicit proxy allowlist;
- Bearer and idempotency propagation;
- issue action controls;
- dual-control proposal launch controls;
- approve/reject/withdraw controls;
- session-only browser token storage;
- no public Web workbench route;
- public Web GET/HEAD boundary retained.

## Disposable database acceptance

Disposable PostGIS:

`tn7-adj8-db`

Clean reset/setup deployment immediately preceding authoritative runtime:

`b060c99a-3ca2-4e2b-96dd-db6a178bdd05`

Result:

**TN7_ADJ8_DB_SETUP_PASS**

The synthetic environment applied:

`001 → 002 → 003 → 004 → 005 → 006 → 007 → 008 → 009 → 010 → 011 → 012`

No live transport data was copied into this database.

## Isolated ADJ9 API

Service:

`tn7-adj9-api`

Exact product-head deployment:

`e50ba13f-2725-486f-a235-81769fe107bf`

Result:

**SUCCESS**

Only this disposable environment enabled the existing adjudication mutation switches.

## Private workbench runtime

Service:

`tn7-adj9-workbench`

Exact product-head deployment:

`f35213eb-ca6d-4698-8bd5-824919c3237c`

Result:

**SUCCESS**

Acceptance URL:

`https://tn7-adj9-workbench-production.up.railway.app`

This is an isolated acceptance workbench, not a production operator deployment.

## Authoritative integrated operator-flow acceptance

Service:

`tn7-adj9-smoke`

Authoritative post-reset deployment:

`627cb466-286f-499d-8e6b-3c0764bff15b`

Exact product head:

`bf20f3644515a07e432ec96f1a5a43c1d81b13bf`

Results:

**TN7_ADJ9_OPERATOR_FLOW_PASS**

**TN7_ADJ9_RUNTIME_PASS**

Proven through the private workbench proxy:

- private UI loads only when explicitly enabled;
- anonymous workbench API access rejected;
- Reviewer can load authenticated workbench;
- unified ADJ1–ADJ8 action catalogue returned;
- isolated acceptance environment exposes all controlled actions as enabled;
- issues, proposals and immutable audit surfaced together;
- Reviewer cannot execute Approver-only direct issue action;
- Approver successfully executes ADJ1 defer;
- workbench reflects deferred state immediately;
- canonical defer audit becomes visible;
- Admin successfully executes ADJ2 reopen;
- workbench reflects reopened state;
- ADJ4 alias proposal created through workbench proxy;
- proposal appears in pending decision queue;
- independent Approver rejects proposal;
- ADJ8 association merge proposal created through workbench proxy;
- proposer self-approval rejected;
- independent Approver sees and approves pending merge;
- approved proposal leaves pending queue;
- approved proposal remains visible in recent decisions;
- proposal creation audit visible;
- canonical merge audit visible;
- proposal approval audit visible;
- direct action audit trail visible;
- public Web does not expose operator workbench.

## Exact-head CI

Product head:

`bf20f3644515a07e432ec96f1a5a43c1d81b13bf`

GitHub results:

- Transport Foundation run `37762604881` — **SUCCESS**
- Map Satellite QA Proof run `37762604749` — **SUCCESS**
- TN6-PROD-4 Security Boundary run `37762604995` — **SUCCESS**

The foundation run includes the PostgreSQL migration suite.

## Normal TN7 preview acceptance

Preview API deployment:

`0fdebd3e-867f-479e-b875-9c2236741d77`

Preview Web deployment:

`563f40e8-4503-4b18-9ed3-c1a493fe0a92`

Both run product head:

`bf20f3644515a07e432ec96f1a5a43c1d81b13bf`

No adjudication mutation switches are enabled in normal preview.

Preview guard service:

`tn7-adj9-preview-guard`

Guard deployment:

`98c08890-f736-4e24-947d-e48452db94df`

Result:

**TN7_ADJ9_PREVIEW_GUARD_PASS**

Proof:

- network inventory available before guard;
- authenticated workbench request fails closed with `503 operator_workbench_schema_unavailable`;
- preview mutation capability is false;
- zero enabled adjudication actions;
- dual-control and all ADJ4–ADJ8 mutation capabilities disabled;
- association merge mutation returns disabled;
- public Web workbench request → 404;
- public Web operator mutation POST → 405;
- rank feed remains healthy;
- association feed remains healthy;
- inventory unchanged after guard:
  - ranks: **744**
  - associations: **35**
  - routes: **1,761**
  - rank-association candidates: **29**

## Production safety

Production `transport-api` remains unchanged.

Current production deployment:

`84df9a55-f1cf-4214-9b50-a762cadaeaea`

Production commit:

`78ce2a643fea61a401d1a79fa69bc3ccc9cda33f`

No production source repoint occurred.

No migrations 005–012 were applied to production PostGIS.

No production adjudication switch was enabled.

The private ADJ9 workbench is not connected to the production transport API and is not exposed through the public Web.

PR #10 remains open, draft and unmerged.

**NO PRODUCTION MUTATION**

**MIGRATIONS 005–012 NOT APPLIED TO PRODUCTION**

**OPERATOR WORKBENCH NOT EXPOSED THROUGH PUBLIC WEB**

**PR #10 REMAINS DRAFT**

## Gate conclusion

ADJ1–ADJ8 are no longer only isolated adjudication primitives.

The trusted operator layer now has one integrated, auditable control surface for:

- evidence review;
- direct controlled issue actions;
- dual-control proposals;
- independent decisions;
- canonical mutation results;
- immutable audit review.

ADJ9 is closed.
