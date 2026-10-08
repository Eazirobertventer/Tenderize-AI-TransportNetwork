# TN7-ADJUDICATION-7 — Controlled Canonical Taxi-Rank Merge Foundation

Date: 2026-10-08

## Verdict

**PASS — controlled canonical taxi-rank merge is proven behind the ADJ3 two-person approval foundation.**

Validated implementation head:

`9631e32cd1763a27c47c2a527e56ebfecfb7cbc9`

Preview-guard correction head:

`db30f3d523a91641a9af41fb5db80a7b8326d730`

Branch:

`phase/tn7-transport-network-operations`

Draft PR:

`#10 — TN7: Transport Network Operations & Data Completion foundation`

## Scope

ADJ7 supports **taxi-rank merge only**.

It does not yet support:

- taxi-association merge;
- route merge;
- automatic primary-entity selection.

The operator explicitly chooses:

- survivor rank;
- duplicate rank.

Proposal endpoint:

`POST /api/v1/operator/proposals/rank-merges`

Approval uses the generic ADJ3 two-person route:

`POST /api/v1/operator/proposals/:proposalId/approve`

## Durable tombstone model

The duplicate taxi-rank row is **not deleted**.

After merge it becomes a durable tombstone with:

- `merged_into_rank_id`;
- `merged_at`;
- `merge_proposal_id`;
- `merge_audit_event_id`.

A database trigger makes a merged tombstone immutable:

- UPDATE blocked;
- DELETE blocked.

This preserves:

- original UUID;
- source candidates;
- source records;
- historical provenance.

Operational rank/map/detail reads hide merged tombstones.

## Migration 011

Committed migration:

`db/011_taxi_rank_merge_foundation.sql`

Adds:

- merge-state fields to `taxi_rank`;
- merge-state consistency constraint;
- `taxi_rank_merge_lineage`;
- durable before/after merge snapshots;
- redirect-count metadata;
- immutable merged-rank trigger.

The lineage record links:

- survivor rank;
- duplicate rank;
- two-person proposal;
- canonical merge audit;
- complete survivor pre-state;
- complete duplicate pre-state;
- canonical after-state;
- redirect counts.

## Frozen merge graph

The proposal SHA-256 snapshot includes both ranks plus their affected graph:

- rank canonical identity and aliases;
- coordinates/location hash;
- Google Place identity;
- canonical association relationships;
- canonical routes using either rank as endpoint;
- rank-association source candidates;
- rank-destination source candidates;
- route candidates;
- rank source records;
- rank data issues;
- promoted aliases;
- pending rank proposals;
- existing merge lineage.

A graph change after proposal creation makes approval stale.

## Source-evidence preservation

ADJ7 does **not** rewrite source evidence to the survivor UUID.

These remain anchored to the duplicate tombstone:

- `rank_association_candidate`;
- `rank_destination_candidate`;
- rank `source_record`.

This preserves source lineage exactly as observed.

Canonical operational edges move to the survivor.

## Canonical redirection

Successful merge can transactionally redirect:

- promoted/non-promoted alias identity registry;
- canonical taxi-rank ↔ association relationships;
- canonical route origin endpoints;
- canonical route destination endpoints;
- active rank data issues.

Duplicate rank canonical name and aliases are transferred to the survivor where normalized identities are not already present.

Overlapping survivor/duplicate association relationships are collapsed only when safe.

## Conflict policy

ADJ7 fails closed on non-deterministic merge state.

### Same entity

Survivor == duplicate:

`409 rank_merge_same_entity`

### Existing tombstone

A survivor or duplicate already merged elsewhere blocks the operation.

### Pending proposal conflict

Any other pending proposal targeting either rank blocks merge.

### Conflicting Google Place identity

If both ranks have different non-null Google Place IDs:

`409 rank_merge_google_place_conflict`

### Third-party alias collision

Duplicate canonical name/aliases are checked against all other active rank canonical names, aliases and promoted aliases.

Collision:

`409 rank_merge_alias_collision`

### Promoted association-relationship conflict

If the duplicate carries a relationship with durable promotion lineage, merge fails closed rather than silently rewriting that lineage:

`409 rank_merge_promoted_relationship_conflict`

### Route self-loop conflict

If merging the duplicate into survivor would turn an existing survivor↔duplicate route into a route whose origin equals destination:

`409 rank_merge_route_self_loop_conflict`

### Projected route duplicate

If endpoint redirection would create duplicate canonical routes for the same association + ordered endpoints:

`409 rank_merge_route_duplicate_conflict`

## Concurrency

The merge pair obtains a PostgreSQL transaction advisory lock over the sorted survivor/duplicate UUID pair.

This serializes competing proposals/approvals for the same two ranks.

## Canonical transaction

Successful approval executes one PostgreSQL transaction:

1. lock proposal;
2. enforce independent Approver/Admin;
3. lock survivor/duplicate merge scope;
4. lock both rank rows;
5. reload all affected canonical/source graph state;
6. apply conflict policy;
7. verify frozen before-state SHA-256;
8. write immutable `taxi_rank.merge` canonical audit;
9. transfer safe aliases;
10. redirect promoted alias registry rows;
11. collapse safe duplicate association pairs;
12. redirect remaining canonical association edges;
13. redirect route origin/destination edges;
14. redirect active rank data issues;
15. mark duplicate as immutable tombstone;
16. write durable merge-lineage row;
17. refresh rank connectivity if present;
18. approve proposal and link canonical audit;
19. write proposal-approval audit;
20. commit.

Any failure rolls all effects back.

## Static gate

Service:

`tn7-adj7-static-check`

Static deployment:

`2616b92b-f47e-4515-bbdd-f28061960fc1`

Result:

**TN7_ADJ7_STATIC_PASS 27/27**

Proven statically:

- tombstone survivor link;
- merge lineage;
- tombstone immutability;
- proposal/audit lineage fields;
- advisory merge locking;
- pending-proposal conflict;
- Google identity conflict;
- alias collision protection;
- promoted-relationship conflict;
- route self-loop conflict;
- projected route duplicate conflict;
- association-edge redirect;
- route endpoint redirect;
- issue redirect;
- promoted-alias redirect;
- source candidate/evidence snapshotting;
- two-person merge proposal;
- canonical merge audit;
- stale-state protection;
- dual-control metadata;
- protected merge endpoint;
- tombstone-aware operational rank reads;
- rank-merge capability switch;
- public Web exclusion.

## Exact PostGIS migration proof

Disposable PostGIS:

`tn7-adj7-db`

Setup service:

`tn7-adj7-db-setup`

Deployment:

`786e983d-898f-4eb9-aa86-0e3497b1a8a5`

Result:

**TN7_ADJ7_DB_SETUP_PASS**

Exact migrations applied in order:

1. `005_operator_audit.sql`
2. `006_data_issue_rejected_status.sql`
3. `007_two_person_decision_proposals.sql`
4. `008_transport_entity_aliases.sql`
5. `009_rank_association_promotions.sql`
6. `010_route_candidate_promotions.sql`
7. `011_taxi_rank_merge_foundation.sql`

Disposable graph included:

- 21 ranks before merge-specific additions were counted in setup;
- 3 associations;
- canonical relationship edges;
- canonical route edges;
- source candidate evidence;
- source records;
- active data issues;
- valid/conflict/atomic/concurrency merge pairs.

No production PostGIS migration was executed.

## Isolated merge API

Service:

`tn7-adj7-api`

Deployment:

`29b5c8a7-dc5e-464f-8411-9e429457a02e`

Status:

**SUCCESS**

Enabled only in the disposable environment:

- `OPERATOR_DUAL_CONTROL_ENABLED=true`
- `OPERATOR_RANK_MERGE_ENABLED=true`

Direct one-person mutation switches remained off.

## Runtime merge proof

Service:

`tn7-adj7-smoke`

Deployment:

`1456fd39-4fde-44d3-9a3f-9d9a61d41189`

Result:

**TN7_ADJ7_RUNTIME_PASS**

### Access / basic validation

- anonymous merge proposal → **401**
- same rank survivor/duplicate → rejected
- Reviewer cannot approve merge → **403**

### Google Place conflict

Different non-null Google Place IDs:

**blocked**

### Alias collision

Duplicate alias colliding with an unrelated third rank canonical identity:

**blocked**

### Route self-loop conflict

A canonical route directly between survivor and duplicate would collapse to a self-loop:

**blocked**

### Successful merge

Reviewer proposed a valid rank merge.

Different Approver approved.

Result:

- duplicate tombstone points to survivor;
- tombstone links proposal + canonical merge audit;
- duplicate canonical name transferred to survivor aliases;
- duplicate aliases transferred safely;
- overlapping association relationship collapsed;
- non-overlap association relationship redirected;
- duplicate has no active canonical association edges;
- canonical route endpoint redirected to survivor;
- duplicate has no canonical route edges;
- active rank data issue redirected to survivor;
- source candidate remains on duplicate tombstone UUID;
- source record remains on duplicate tombstone UUID;
- durable merge-lineage row written;
- redirect counts retained;
- canonical `taxi_rank.merge` audit written once.

### Operational tombstone behavior

After merge:

- operational rank feed hides duplicate tombstone;
- active rank-detail endpoint returns **404** for duplicate tombstone.

### Idempotent approval replay

Same approval key:

- safe replay;
- canonical merge audit remains exactly one row.

### Tombstone immutability

Direct SQL UPDATE of merged duplicate:

**blocked**

Direct SQL DELETE of merged duplicate:

**blocked**

### Stale graph protection

Merge proposal created.

An active data issue belonging to duplicate changed afterward.

Approval:

**409 decision_proposal_stale_before_state**

Duplicate remained active.

### Concurrent proposal serialization

Two Reviewers submitted merge proposals concurrently for the same survivor/duplicate pair.

Result:

- exactly one proposal created;
- exactly one competing proposal rejected;
- winning proposal could be independently approved;
- duplicate became tombstone exactly once.

### Atomic rollback

A fresh merge proposal was created.

Disposable audit constraint forced final `decision_proposal.approve` audit to fail after merge work began.

Result:

- tombstone marking rolled back;
- relationship redirects rolled back;
- route redirect rolled back;
- data-issue redirect rolled back;
- merge-lineage insert rolled back;
- canonical merge audit rolled back;
- proposal approval state rolled back.

Proof marker:

**TN7_ADJ7_ATOMIC_MERGE_ROLLBACK_PASS**

### Audit ordering

All audit events remained monotonic.

Result:

**TN7_ADJ7_AUDIT_SEQUENCE_PASS 9**

Disposable active counts after successful proof merges:

- active ranks: **33**
- routes: **5**

## Normal TN7 preview

Current normal preview code includes the merge implementation, but every mutation switch remains absent.

Normal preview API/Web were healthy on the implementation branch before the guard-only test commit.

## Preview fail-closed proof

The first guard run used the non-existent path `/api/v1/ranks/map`; the API correctly interpreted `map` as a rank UUID and rejected it. The guard was corrected to use the real operational rank feed:

`GET /api/v1/ranks`

Corrected guard commit:

`db30f3d523a91641a9af41fb5db80a7b8326d730`

Guard runner:

`tn7-adj7-preview-guard-r2`

Deployment:

`3f048fff-5626-4b71-8a18-b35c1fcaf948`

Result:

**TN7_ADJ7_PREVIEW_GUARD_PASS**

Proof:

- preview inventory available;
- valid Reviewer rank-merge proposal → **503 rank_merge_disabled**;
- valid Approver proposal approval → **503 dual_control_disabled**;
- operator capabilities report mutation disabled;
- rank-merge capability absent;
- public Web merge proposal POST → **405**;
- public Web proposal GET → **404**;
- operational rank feed remains healthy;
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
- 011

No production rank was merged.

No production canonical relationship/route was redirected.

No production tombstone was created.

TN6 production services remain unchanged.

## Scope boundary

ADJ7 supports rank merge only.

Association merge remains unsupported.

This gate deliberately preserves source evidence on the duplicate tombstone rather than rewriting historical observations.

## Next recommended gate

**TN7-ADJUDICATION-8 — Controlled Association Merge Foundation**

Only proceed after treating association merge as a separate graph operation.

Recommended scope:

- survivor + duplicate association;
- freeze canonical names/acronyms/aliases;
- rank relationships;
- canonical routes;
- association source records;
- open issues;
- source association evidence;
- conflict detection for registration numbers and overlapping route/rank semantics;
- safe alias/acronym transfer;
- transactional relationship/route redirection;
- durable association tombstone and merge lineage;
- two-person approval;
- concurrency lock;
- stale-state protection;
- full rollback proof;
- default-off preview/production switch.


---

## Current-head runtime reacceptance

ADJ7 was re-run after the interrupted session against the current implementation head:

`9631e32cd1763a27c47c2a527e56ebfecfb7cbc9`

This section supersedes the earlier deployment IDs for current-head acceptance while retaining the earlier run above as historical evidence.

### Static gate

Deployment:

`2616b92b-f47e-4515-bbdd-f28061960fc1`

Result:

**TN7_ADJ7_STATIC_PASS 27/27**

### Exact PostGIS setup

Disposable database:

`tn7-adj7-db`

Setup deployment:

`976621e5-d978-493f-9f29-83d871d271aa`

Result:

**TN7_ADJ7_DB_SETUP_PASS**

Exact migrations applied:

`005 → 006 → 007 → 008 → 009 → 010 → 011`

### Isolated merge API

Deployment:

`683f2b3b-a54c-4096-a6bc-de93a31fcd33`

Head:

`9631e32cd1763a27c47c2a527e56ebfecfb7cbc9`

Status:

**SUCCESS**

Enabled only in the disposable environment:

- `OPERATOR_DUAL_CONTROL_ENABLED=true`
- `OPERATOR_RANK_MERGE_ENABLED=true`

### Authoritative runtime merge proof

Deployment:

`91b2991d-91df-4694-9f31-5ad0f52e5f49`

Result:

**TN7_ADJ7_RUNTIME_PASS**

Re-proven on the current head:

- anonymous merge rejected;
- same-entity merge rejected;
- Google Place conflict rejected;
- third-party alias collision rejected;
- projected route self-loop rejected;
- valid two-person merge succeeds;
- tombstone points to survivor;
- proposal/audit lineage retained;
- duplicate names/aliases transferred;
- overlapping association relationship collapsed;
- non-overlap relationship redirected;
- canonical route endpoint redirected;
- active rank issue redirected;
- source evidence remains anchored to duplicate tombstone UUID;
- operational rank map hides tombstone;
- active tombstone detail returns 404;
- approval replay is idempotent;
- tombstone UPDATE/DELETE blocked;
- stale graph approval rejected;
- concurrent pair proposals serialize to one pending proposal;
- winning proposal can be independently approved;
- forced final approval-audit failure rolls back tombstone, relationships, routes, issues, lineage, canonical merge audit and proposal state.

Proof markers:

- **TN7_ADJ7_ATOMIC_MERGE_ROLLBACK_PASS**
- **TN7_ADJ7_AUDIT_SEQUENCE_PASS 9**
- **TN7_ADJ7_RUNTIME_PASS**

Disposable active state after proof merges:

- active ranks: **33**
- canonical routes: **5**

### Normal TN7 preview on current head

API deployment:

`1d6c48b1-4f8a-416f-ba52-a9701256c42a`

Web deployment:

`879843d1-225e-41af-ba61-b252f31ed07b`

Both:

**SUCCESS**

Normal preview variables contain none of the mutation switches, including:

- `OPERATOR_DUAL_CONTROL_ENABLED`
- `OPERATOR_RANK_MERGE_ENABLED`

### Current-head preview guard

Deployment:

`2907cdea-1ed2-4aa8-aeb3-17f7e25382ff`

Result:

**TN7_ADJ7_PREVIEW_GUARD_PASS**

Proof:

- operational rank feed remains schema-compatible without migration 011;
- valid Reviewer rank-merge proposal → **503 rank_merge_disabled**;
- valid Approver proposal approval → **503 dual_control_disabled**;
- operator capabilities report rank merge disabled;
- zero enabled mutation actions;
- public Web merge proposal POST → **405**;
- public Web proposal GET → **404**;
- live inventory unchanged:
  - ranks: **744**
  - associations: **35**
  - routes: **1,761**
  - rank-association candidates: **29**

### Current production status

**No production mutation.**

Migration 011 remains unapplied to production PostGIS.

No production rank was merged, tombstoned, redirected or deleted.
