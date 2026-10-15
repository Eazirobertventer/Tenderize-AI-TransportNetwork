# TN7-ADJUDICATION-5 — Controlled Association Operating-Relationship Assignment

Date: 2026-10-07

## Verdict

**PASS — reviewed rank↔association evidence can be promoted into a canonical operating relationship behind ADJ3 two-person approval.**

Validated implementation head:

`14da9c5b931b66a9aae771949e6e112eb4cdc3da`

Branch:

`phase/tn7-transport-network-operations`

Draft PR:

`#10 — TN7: Transport Network Operations & Data Completion foundation`

## Semantic scope

The current canonical schema is many-to-many.

ADJ5 therefore promotes:

**taxi rank ↔ operating taxi association**

It does **not** invent a unique primary-owner concept.

A rank may retain more than one canonical operating association when reviewed evidence supports that relationship.

## Evidence anchor

Proposal endpoint:

`POST /api/v1/operator/proposals/rank-association-candidates/:candidateId/assign`

The operator must select:

- a specific `rank_association_candidate`;
- a target canonical association.

The candidate must already resolve to a canonical rank.

The candidate's source label is normalized through the database identity-normalization function and must match the selected association through one of:

- canonical association name;
- acronym;
- promoted/known alias.

A free-form unrelated association cannot be attached to a rank through this action.

## Competing evidence policy

Before proposal creation and again at approval, the system loads **all rank-association candidate evidence for the rank**.

If any unresolved candidate label normalizes to an identity outside the selected association's canonical name/acronym/aliases:

`409 rank_association_candidate_conflict`

Promotion stops.

Multiple evidence records that resolve to the **same selected association identity** are allowed.

## Migration 009

Committed migration:

`db/009_rank_association_promotions.sql`

Adds:

- stable UUID `relationship_id` to canonical `taxi_rank_association`;
- unique relationship UUID index;
- `rank_association_promotion` lineage table.

Promotion lineage stores:

- candidate ID;
- relationship ID;
- rank ID;
- association ID;
- two-person proposal ID;
- canonical mutation audit-event ID;
- promotion timestamp.

Uniqueness constraints ensure:

- one candidate cannot be promoted twice;
- one proposal cannot produce multiple relationships;
- one promotion row per canonical relationship.

The existing canonical composite primary key continues to prevent duplicate rank↔association pairs.

## Proposal snapshot

ADJ5 freezes a composite canonical state containing:

- selected candidate;
- canonical rank;
- selected association;
- normalized association identity set;
- current canonical relationship set for the rank;
- complete current candidate-evidence set for the rank;
- current promotion state.

The ADJ3 SHA-256 before-state hash covers this composite state.

Any change to the rank, association, relationship set or candidate evidence after proposal creation makes approval stale.

## Concurrency

Assignment approval acquires a transaction-scoped PostgreSQL advisory lock for:

`rank-association:<rank UUID>`

Then it reloads and revalidates the complete evidence/relationship snapshot.

This serializes competing approvals for the same rank.

## Canonical mutation

Successful approval:

1. locks proposal;
2. enforces different proposer and approver;
3. reloads candidate;
4. takes rank advisory lock;
5. locks rank and selected association;
6. loads current relationship set;
7. loads complete candidate evidence set;
8. verifies target association identity match;
9. blocks competing unresolved labels;
10. blocks existing exact relationship;
11. verifies frozen before-state SHA-256;
12. inserts canonical `taxi_rank_association` with `verification_status='verified'`;
13. writes immutable `taxi_rank_association.assign` canonical audit;
14. inserts promotion-lineage row;
15. marks proposal approved and links canonical audit;
16. writes proposal-approval audit;
17. commits.

Any failure rolls all steps back.

## Source evidence immutability

The source `rank_association_candidate` evidence row is **not** rewritten as part of promotion.

A promoted candidate remains source evidence with its existing verification classification.

Canonical decision state is represented by:

- canonical relationship;
- promotion lineage;
- immutable operator audits.

## Kill switch

Default:

`OPERATOR_ASSOCIATION_ASSIGNMENT_ENABLED=false`

It also requires:

`OPERATOR_DUAL_CONTROL_ENABLED=true`

No direct one-person relationship-assignment endpoint exists.

## Static gate

Service:

`tn7-adj5-static-check`

Deployment:

`c29db4e3-3c7d-4f00-868d-f6c2feb1b472`

Result:

**TN7_ADJ5_STATIC_PASS 24/24**

Static proof includes:

- stable relationship UUID;
- promotion-lineage schema;
- candidate/proposal uniqueness;
- assignment kill switch;
- unresolved-rank fail closed;
- candidate-to-association identity binding;
- competing-candidate detection;
- duplicate canonical-link detection;
- already-promoted candidate detection;
- rank advisory lock;
- database identity normalization;
- verified canonical insert;
- promotion-lineage insertion;
- two-person proposal;
- canonical assignment audit;
- stale-state protection;
- dual-control audit metadata;
- proposal approval lineage;
- protected proposal route;
- public Web exclusion.

## Exact migration proof

Disposable Postgres:

`tn7-adj5-db`

Setup service:

`tn7-adj5-db-setup`

Deployment:

`c74765b3-84dc-4c93-b0dd-681e0de832b8`

Result:

**TN7_ADJ5_DB_SETUP_PASS**

Exact migrations applied in order:

1. `005_operator_audit.sql`
2. `006_data_issue_rejected_status.sql`
3. `007_two_person_decision_proposals.sql`
4. `008_transport_entity_aliases.sql`
5. `009_rank_association_promotions.sql`

Disposable relationship fixtures:

- ranks: **9**
- associations: **3**
- evidence candidates: **11**
- pre-existing canonical relationships: **2**

No production PostGIS migration was executed.

## Isolated assignment API

Service:

`tn7-adj5-api`

Deployment:

`7203c8fa-fbe0-4233-bd5b-ea5f2fa836b8`

Status:

**SUCCESS**

Enabled only in this disposable environment:

- `OPERATOR_DUAL_CONTROL_ENABLED=true`
- `OPERATOR_ASSOCIATION_ASSIGNMENT_ENABLED=true`

Direct one-person defer/reject/reopen/alias switches remained off.

## Runtime proof

Service:

`tn7-adj5-smoke`

Deployment:

`39695c9f-5c93-49f1-9404-07d2a31ad664`

Result:

**TN7_ADJ5_RUNTIME_PASS**

### Access/input

- anonymous proposal → **401**
- missing association ID → **400**

### Candidate identity mismatch

Candidate label:

`Unknown Operators Association`

Target:

`Alpha Taxi Association`

Result:

**409 rank_association_candidate_identity_mismatch**

### Competing candidate conflict

One rank had evidence for:

- Alpha Taxi Association
- Beta Taxi Association

Proposal to promote Alpha:

**409 rank_association_candidate_conflict**

Returned competing normalized label:

`beta taxi association`

### Existing canonical relationship

A rank already linked to Alpha had an Alpha candidate.

Proposal result:

**409 rank_association_relationship_exists**

### Valid promotion

A rank had two source candidate labels:

- `Alpha Taxi Association`
- `ATA`

Both resolve to the same association identity.

Reviewer proposal → **201**

Different Approver approval → **200**

Result:

- one canonical relationship inserted;
- `verification_status='verified'`;
- stable relationship UUID generated;
- promotion-lineage row written;
- promotion links candidate, proposal, relationship and canonical audit;
- canonical audit attributed to Approver;
- canonical audit marks dual control;
- canonical audit links candidate, rank and association.

The source candidate remained `documented`.

### Idempotent approval replay

Same Approver + same approval key:

- safe replay;
- no duplicate relationship;
- no duplicate canonical audit.

### Candidate promotion uniqueness

After successful promotion, a second proposal using the same candidate:

**409 rank_association_candidate_already_promoted**

### Many-to-many operating semantics

A rank already had canonical Beta association.

It had separate reviewed Alpha evidence.

Alpha promotion succeeded.

Result:

- existing Beta link retained;
- new Alpha link added;
- rank has two canonical operating associations.

ADJ5 therefore does not falsely impose exclusive ownership.

### Frozen evidence/stale-state proof

Proposal created from valid Alpha evidence.

A second source candidate for the same rank was added after proposal creation.

The added label also resolved to Alpha, so it did not create an association conflict—but it changed the frozen evidence set.

Approval:

**409 decision_proposal_stale_before_state**

No relationship created.

Proposal remained pending.

### Proposal rejection

Valid relationship proposal rejected by independent Approver.

Result:

- proposal → rejected;
- no canonical relationship created.

### Concurrent duplicate promotion

Two different Reviewers created proposals from the same Gamma candidate before any approval.

Two different Approvers approved concurrently.

Result:

- exactly one approval succeeded;
- exactly one approval returned conflict;
- exactly one canonical relationship exists;
- exactly one promotion-lineage row exists.

The rank-scoped advisory lock + revalidation prevents duplicate concurrent promotion.

### Atomic rollback

A valid Beta-assignment proposal was created.

The disposable audit table was constrained so the final `decision_proposal.approve` audit would fail.

Result:

- API returned server error;
- canonical relationship insert rolled back;
- promotion-lineage insert rolled back;
- proposal state rolled back to `proposed`;
- canonical assignment audit rolled back.

Proof marker:

**TN7_ADJ5_ATOMIC_ASSIGNMENT_ROLLBACK_PASS**

### Database uniqueness backstops

Direct duplicate canonical pair insert:

**blocked by composite primary key**

Direct duplicate promotion-lineage insert:

**blocked by unique constraint**

Proof marker:

**TN7_ADJ5_RELATIONSHIP_UNIQUENESS_PASS**

### Audit ordering

All audit events remained strictly monotonic.

Result:

**TN7_ADJ5_AUDIT_SEQUENCE_PASS 14**

Final disposable canonical relationships:

**5**

Final promotion-lineage rows:

**3**

## Normal TN7 preview

API deployment:

`cb122454-c063-41b1-874d-929e78d092f3`

Web deployment:

`a0daff6c-a201-4bc8-ab89-e8a1a1dde250`

Both are **SUCCESS** on the ADJ5 implementation head.

Normal preview variables contain none of:

- `OPERATOR_DEFER_ISSUE_ENABLED`
- `OPERATOR_REJECT_ISSUE_ENABLED`
- `OPERATOR_REOPEN_ISSUE_ENABLED`
- `OPERATOR_DUAL_CONTROL_ENABLED`
- `OPERATOR_ALIAS_PROMOTION_ENABLED`
- `OPERATOR_ASSOCIATION_ASSIGNMENT_ENABLED`

## Preview fail-closed proof

Guard service:

`tn7-adj5-preview-guard`

Deployment:

`9d6c4d4b-a233-4101-abac-3d33cdf77731`

Result:

**TN7_ADJ5_PREVIEW_GUARD_PASS**

Proof:

- valid Reviewer assignment proposal → **503 association_assignment_disabled**
- valid Approver proposal approval → **503 dual_control_disabled**
- operator capabilities report association assignment disabled;
- zero enabled mutation actions;
- public Web assignment proposal POST → **405**
- public Web proposal GET → **404**
- network inventory unchanged:
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

No production rank↔association relationship was created.

TN6 production services remain unchanged.

Normal TN7 assignment/dual-control switches remain disabled.

## Next recommended gate

**TN7-ADJUDICATION-6 — Controlled Route Candidate Promotion**

Use the same evidence-anchored dual-control pattern to promote exact/source-backed route candidates into canonical `taxi_route` records.

Required safeguards:

- proposal anchored to a specific `route_candidate`;
- freeze candidate, origin/destination ranks, association ownership state and geometry evidence;
- association must already be canonical where route ownership is claimed;
- distinguish source geometry vs endpoint-only evidence;
- never promote endpoint connectors as travelled road geometry;
- duplicate route-code / endpoint conflict checks;
- stale-state hash;
- independent Approver;
- concurrent duplicate-route approval proof;
- atomic canonical route + lineage + audit + proposal approval;
- rollback proof;
- default-off preview/production switch.
