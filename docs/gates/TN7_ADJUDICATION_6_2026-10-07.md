# TN7-ADJUDICATION-6 — Controlled Route Candidate Promotion

Date: 2026-10-07

## Verdict

**PASS — exact, source-backed route candidates can be promoted into canonical taxi routes behind the ADJ3 two-person approval foundation.**

Validated implementation head:

`48b11b1f0ce0157872b10a8f4139e9a7656229bc`

Branch:

`phase/tn7-transport-network-operations`

Draft PR:

`#10 — TN7: Transport Network Operations & Data Completion foundation`

## Scope

ADJ6 promotes a specific `route_candidate` into a canonical `taxi_route`.

Proposal endpoint:

`POST /api/v1/operator/proposals/route-candidates/:candidateId/promote`

Approval continues through the generic ADJ3 route:

`POST /api/v1/operator/proposals/:proposalId/approve`

It requires:

- trusted operator identity;
- proposal by Reviewer / Approver / Admin;
- independent Approver/Admin;
- proposal idempotency;
- approval idempotency;
- `OPERATOR_DUAL_CONTROL_ENABLED=true`;
- `OPERATOR_ROUTE_PROMOTION_ENABLED=true`.

No direct one-person route-promotion endpoint exists.

## Evidence eligibility

A promotable route candidate must:

- reconcile an `exact_endpoint_pair`;
- have distinct origin and destination ranks;
- point to a real `source_route_geometry`;
- have valid, non-empty MultiLineString geometry;
- contain at least two geometry points;
- have eligible candidate/source verification state;
- not be tagged as endpoint connector, straight-line demo, inferred geometry or non-route-path evidence;
- not already be promoted;
- not already have a canonical source record.

The separate NLTIS endpoint connectors displayed on the map are therefore not promotable as travelled road geometry.

## Association ownership

The selected association must be canonical at **both endpoint ranks**.

If the candidate explicitly carries an association and it differs from the selected association:

`409 route_candidate_association_conflict`

If the selected association is not shared by both endpoints:

`409 route_candidate_association_not_shared_by_endpoints`

If the endpoints share more than one canonical association:

`409 route_candidate_endpoint_association_conflict`

ADJ6 fails closed rather than guessing route ownership.

## Duplicate protection

Before proposal creation and again at approval:

- same association + same ordered origin/destination → `canonical_route_endpoint_duplicate`;
- route-code collision within the selected association → `canonical_route_code_collision`;
- existing canonical source record → `route_candidate_source_record_already_canonical`;
- candidate/source geometry already promoted → `route_candidate_already_promoted`.

The source route code is stored as `source_route_code`.

It is **not** silently reclassified as:

- `national_route_code`; or
- `board_route_code`.

## Migration 010

Committed migration:

`db/010_route_candidate_promotions.sql`

Changes:

- adds `taxi_route.source_route_code`;
- creates `route_candidate_promotion`.

Promotion lineage links:

- route candidate;
- source route geometry;
- canonical route;
- canonical source record;
- two-person proposal;
- canonical promotion audit.

Each linkage is unique.

## Frozen proposal state

The ADJ3 SHA-256 proposal snapshot includes:

- route candidate;
- origin/destination ranks;
- selected association;
- endpoint association relationships;
- source registry identity;
- source geometry metadata;
- source payload;
- source geometry hash;
- candidate provenance;
- existing source record state;
- duplicate-route state;
- promotion state.

Changes to source geometry evidence after proposal creation make approval stale.

## Canonical mutation

Successful approval executes one transaction:

1. lock proposal;
2. enforce different proposer and approver;
3. reload/lock candidate and source geometry;
4. lock promotion scope;
5. verify endpoint associations;
6. verify source geometry eligibility;
7. recheck duplicate route/code/source record state;
8. verify frozen before-state SHA-256;
9. insert canonical `taxi_route`;
10. copy source geometry exactly;
11. calculate route distance from source geometry;
12. insert canonical `source_record`;
13. set `source_route_geometry.promoted_route_id`;
14. write immutable `taxi_route.promote` audit;
15. insert route promotion lineage;
16. mark proposal approved;
17. write proposal-approval audit;
18. commit.

Any failure rolls the complete transaction back.

## Canonical route semantics

The promoted route preserves:

- selected canonical association;
- exact origin/destination ranks;
- source route code;
- source map title/category;
- source geometry;
- candidate verification status;
- candidate confidence;
- source/candidate provenance.

Documented source geometry is stored as:

`geometry_status='source_documented'`

Official geometry may use:

`official_source`

ADJ6 does not infer road routing.

## Static gate

Service:

`tn7-adj6-static-check`

Deployment:

`840405e3-ebdc-464b-a9eb-fdf836ae0c62`

Result:

**TN7_ADJ6_STATIC_PASS 28/28**

Static proof includes:

- source route code preservation;
- promotion lineage;
- single-promotion constraints;
- route promotion kill switch;
- exact endpoint eligibility;
- endpoint association ownership;
- multi-association ambiguity failure;
- candidate association conflict;
- endpoint/demo/inferred geometry blocking;
- frozen geometry hash;
- PostGIS validity checks;
- existing source-record duplicate prevention;
- endpoint duplicate prevention;
- route-code collision detection;
- provenance `source_record`;
- source geometry promotion pointer;
- dual-control proposal;
- canonical promotion audit;
- stale-state protection;
- public Web exclusion.

## Exact PostGIS migration proof

Disposable PostGIS:

`tn7-adj6-db`

Setup service:

`tn7-adj6-db-setup`

Deployment:

`e7db16ec-b5c5-4eae-a0c6-709b8551cfe4`

Result:

**TN7_ADJ6_DB_SETUP_PASS**

Exact migrations applied in order:

1. `005_operator_audit.sql`
2. `006_data_issue_rejected_status.sql`
3. `007_two_person_decision_proposals.sql`
4. `008_transport_entity_aliases.sql`
5. `009_rank_association_promotions.sql`
6. `010_route_candidate_promotions.sql`

Disposable route fixtures used actual PostGIS MultiLineString geometry.

No production PostGIS migration was executed.

## Isolated route-promotion API

Service:

`tn7-adj6-api`

Deployment:

`79bd9952-9345-4a1d-9566-091a52155521`

Status:

**SUCCESS**

Enabled only in this disposable environment:

- `OPERATOR_DUAL_CONTROL_ENABLED=true`
- `OPERATOR_ROUTE_PROMOTION_ENABLED=true`

All direct one-person mutation switches remained off.

## Runtime proof

Service:

`tn7-adj6-smoke`

Deployment:

`a6bd36ba-4990-4bac-8099-3d9e7ab32029`

Result:

**TN7_ADJ6_RUNTIME_PASS**

### Access/input

- anonymous route proposal → **401**
- missing association ID → **400**
- Reviewer approval → **403**

### Endpoint-only geometry blocked

Candidate backed by geometry explicitly marked as endpoint-connector / not-route-path evidence:

**409 route_candidate_geometry_evidence_only**

No canonical route was created.

### Candidate association conflict

Candidate explicitly associated with Beta, selected association Alpha:

**409 route_candidate_association_conflict**

### Endpoint association ambiguity

Origin and destination shared both Alpha and Beta.

Promotion:

**409 route_candidate_endpoint_association_conflict**

### Selected association must exist at both endpoints

A candidate whose two endpoint ranks did not both carry Alpha:

**409 route_candidate_association_not_shared_by_endpoints**

### Route-code collision

Candidate route code collided with an existing canonical route under the selected association.

Result:

**409 canonical_route_code_collision**

### Existing source record

A source route record was already represented canonically.

Promotion:

**409 route_candidate_source_record_already_canonical**

### Successful route promotion

Reviewer created a proposal from an exact source-backed candidate.

Different Approver approved.

Result:

- canonical route created;
- selected association preserved;
- exact origin/destination ranks preserved;
- source route code retained in `source_route_code`;
- national/board route codes remain null;
- geometry status honestly classified as `source_documented`;
- candidate verification status retained;
- canonical geometry hash exactly equals source geometry hash;
- route distance calculated from source geometry;
- canonical `source_record` created;
- source record geometry equals canonical geometry;
- source record retains candidate/source-geometry/proposal provenance;
- source record checksum equals source geometry hash;
- source geometry `promoted_route_id` points to canonical route;
- promotion lineage links route/candidate/source record/proposal/audit;
- canonical audit attributed to Approver;
- canonical audit marked `dualControl:true`;
- geometry hash frozen in audit metadata.

The source route candidate remained `documented` and its association field was not rewritten.

### Idempotent replay

Same approval idempotency key:

- safe replay;
- one canonical route;
- one canonical route audit.

### Candidate cannot promote twice

Second proposal after successful promotion:

**409 route_candidate_already_promoted**

### Endpoint duplicate protection

A second candidate with a different source code but the same association and ordered endpoint pair:

**409 canonical_route_endpoint_duplicate**

### Stale geometry/source evidence

A valid route proposal was created.

Source geometry payload changed after proposal creation.

Approval:

**409 decision_proposal_stale_before_state**

No canonical route created.

Proposal remained pending.

### Proposal rejection

Current route proposal rejected by independent Approver.

Result:

- proposal → rejected;
- no canonical route created.

### Concurrent duplicate promotion

Two Reviewers created proposals from the same route candidate.

Two Approvers approved concurrently.

Result:

- exactly one approval succeeded;
- exactly one approval returned conflict;
- exactly one canonical route created;
- exactly one promotion-lineage row created;
- source geometry marked promoted once.

### Atomic rollback

A disposable audit constraint forced final `decision_proposal.approve` audit failure after route-promotion work began.

Result:

- canonical route insert rolled back;
- canonical source record rolled back;
- source geometry promotion pointer rolled back;
- route promotion lineage rolled back;
- proposal approval rolled back to `proposed`;
- canonical route promotion audit rolled back.

Proof marker:

**TN7_ADJ6_ATOMIC_ROUTE_ROLLBACK_PASS**

### Database lineage uniqueness

Direct duplicate promotion-lineage insert:

**blocked**

Proof:

**TN7_ADJ6_ROUTE_UNIQUENESS_PASS**

### Audit ordering

All audit events remained monotonic.

Result:

**TN7_ADJ6_AUDIT_SEQUENCE_PASS 11**

Final disposable canonical route count:

**3**  
(includes seeded canonical collision route + 2 successful proof promotions)

Final route-promotion lineage count:

**2**

## Normal TN7 preview

Route-promotion code is present on the TN7 preview but all mutation switches remain absent.

## Preview fail-closed proof

Guard service:

`tn7-adj6-preview-guard`

Deployment:

`d2861bbe-f586-464b-a9eb-fdf836ae0c62`

Result:

**TN7_ADJ6_PREVIEW_GUARD_PASS**

Proof:

- valid Reviewer route promotion proposal → **503 route_promotion_disabled**
- valid Approver proposal approval → **503 dual_control_disabled**
- operator capabilities report route promotion disabled;
- zero enabled mutation actions;
- public Web route proposal POST → **405**
- public Web proposal GET → **404**
- live inventory unchanged:
  - ranks: **744**
  - associations: **35**
  - routes: **1,761**
  - rank-association candidates: **29**

## Production status

**No production mutation.**

Migrations unapplied to production PostGIS:

- 005
- 006
- 007
- 008
- 009
- 010

No production canonical route was created.

No production source geometry was marked promoted.

TN6 production services remain unchanged.

## Next recommended gate

**TN7-ADJUDICATION-7 — Controlled Canonical Entity Merge Foundation**

This should be treated as a substantially higher-blast-radius gate.

Recommended scope:

- begin with rank merge only;
- explicit survivor + duplicate entities;
- freeze all aliases, locations, relationships, routes, source records and open issues for both entities;
- reject merge if canonical relationship/route conflicts cannot be deterministically reconciled;
- require independent two-person approval;
- preserve all source provenance;
- redirect foreign keys transactionally;
- transfer unique aliases safely;
- retain immutable merge/tombstone lineage;
- stale-state hash across both entities and all affected edges;
- concurrent merge lock;
- rollback proof;
- no delete without durable merge lineage;
- default-off preview/production switch.
