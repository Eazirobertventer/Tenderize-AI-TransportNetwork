# TN7-ADJUDICATION-7 — Controlled Canonical Taxi-Rank Merge Foundation

Date: 2026-10-07

## Verdict

**PASS — canonical taxi-rank merge is proven behind the ADJ3 two-person approval boundary, with durable tombstones, conflict detection, canonical-edge redirection and atomic rollback.**

Validated runtime head:

`2483d743fa70e9b1628e8a707c60fdebcf077424`

Branch:

`phase/tn7-transport-network-operations`

Draft PR:

`#10 — TN7: Transport Network Operations & Data Completion foundation`

## Scope boundary

ADJ7 implements **taxi-rank merge only**.

It does not enable:

- taxi-association merge;
- route merge;
- destructive deletion of duplicate rank identity;
- automatic merge from fuzzy similarity.

A merge requires an explicit survivor rank and duplicate rank and remains behind trusted identity, two-person approval and a default-off kill switch.

## Durable tombstone model

The duplicate rank is **not deleted**.

Migration:

`db/011_taxi_rank_merge_foundation.sql`

adds merge state to `taxi_rank`:

- `merged_into_rank_id`
- `merged_at`
- `merge_proposal_id`
- `merge_audit_event_id`

and creates:

`taxi_rank_merge_lineage`

The duplicate UUID remains durable as a tombstone so source evidence and historical references retain their original identity.

A database trigger makes a merged taxi-rank tombstone immutable:

- UPDATE blocked;
- DELETE blocked.

The lineage record stores:

- survivor rank;
- duplicate rank;
- proposal ID;
- canonical merge audit ID;
- survivor pre-merge snapshot;
- duplicate pre-merge snapshot;
- after-state;
- redirect counts;
- merge timestamp.

## Operational visibility

Merged tombstones are hidden from active operational rank reads.

The API uses a schema-compatible `to_jsonb(...)->>'merged_into_rank_id'` predicate so the ADJ7 code remains safe on environments where migration 011 has not yet been applied.

Covered surfaces include:

- rank map/search;
- rank filters;
- national/province/area rank counts;
- network inventory/readiness counts;
- active rank detail.

The duplicate remains in Postgres for lineage/provenance, but is no longer presented as an active rank after merge.

## Proposal endpoint

`POST /api/v1/operator/proposals/rank-merges`

Required body:

- `survivorRankId`
- `duplicateRankId`
- rationale
- evidence

Requirements:

- Reviewer / Approver / Admin may propose;
- independent Approver/Admin must approve;
- self-approval remains denied by ADJ3;
- idempotency key required;
- `OPERATOR_DUAL_CONTROL_ENABLED=true`;
- `OPERATOR_RANK_MERGE_ENABLED=true`.

No direct one-person merge endpoint exists.

## Frozen merge graph

The proposal snapshot covers both ranks and all affected canonical/evidence surfaces available to the platform:

### Rank identities

- canonical name;
- legacy aliases;
- geography and coordinates;
- Google Place ID;
- verification state;
- operational metadata.

### Canonical edges

- rank↔association relationships;
- canonical route endpoints.

### Evidence/provenance

- rank-association candidates;
- rank-destination candidates;
- route candidates touching either rank;
- taxi-rank source records;
- data issues;
- promoted aliases;
- existing merge lineage;
- pending rank proposals.

The full graph is SHA-256 frozen through the ADJ3 proposal before-state hash.

Any material graph change after proposal creation causes approval to fail stale.

## Conflict policy

ADJ7 deliberately fails closed when automatic reconciliation would be ambiguous.

### Same entity

Survivor and duplicate cannot be the same UUID.

### Existing tombstone

Neither rank may already be merged.

### Pending proposal conflict

Other pending taxi-rank proposals touching either entity block merge.

### Google identity conflict

If both ranks have non-empty, different Google Place IDs:

`rank_merge_google_place_conflict`

### Third-party identity collision

The duplicate canonical name and aliases are checked against all other active rank canonical names, legacy aliases and promoted aliases.

Collision:

`rank_merge_alias_collision`

### Promoted relationship conflict

A duplicate rank relationship with existing ADJ5 promotion lineage is not automatically rewritten.

Result:

`rank_merge_promoted_relationship_conflict`

This preserves previously adjudicated relationship lineage until a dedicated lineage-preserving reconciliation rule exists.

### Route self-loop conflict

If replacing duplicate with survivor would turn an existing route into survivor→survivor:

`rank_merge_route_self_loop_conflict`

### Route duplicate conflict

If endpoint redirection would produce two canonical routes with the same association + ordered origin/destination:

`rank_merge_route_duplicate_conflict`

No route is automatically discarded or merged.

## Canonical merge mutation

A successful merge approval executes in one PostgreSQL transaction:

1. lock proposal;
2. enforce different proposer/approver identities;
3. take deterministic survivor+duplicate advisory lock;
4. lock both rank rows;
5. reload canonical/evidence graph;
6. rerun conflict checks;
7. verify frozen before-state hash;
8. write immutable `taxi_rank.merge` canonical audit;
9. transfer non-duplicate duplicate canonical name/aliases to survivor;
10. redirect promoted alias registry rows;
11. collapse overlapping non-promoted rank↔association links;
12. redirect remaining canonical rank↔association links;
13. redirect canonical route origin endpoints;
14. redirect canonical route destination endpoints;
15. redirect active taxi-rank data issues;
16. mark duplicate as immutable tombstone;
17. insert durable merge lineage with redirect counts;
18. refresh rank-connectivity materialized view when present;
19. mark proposal approved;
20. append proposal-approval audit;
21. commit.

Any failure rolls the entire transaction back.

## Source-evidence preservation

ADJ7 deliberately does **not** rewrite source evidence to pretend it was originally attached to the survivor.

The following remain anchored to the duplicate tombstone UUID:

- taxi-rank `source_record` rows;
- rank-association candidate evidence;
- rank-destination candidate evidence;
- other historical source evidence.

The tombstone + merge lineage explains how that historical identity now resolves to the survivor.

This preserves provenance rather than rewriting history.

## Static gate

Service:

`tn7-adj7-static-check`

Deployment:

`2616b92b-f47e-4515-bbdd-f28061960fc1`

Result:

**TN7_ADJ7_STATIC_PASS 27/27**

Static checks proved:

- durable survivor link;
- merge lineage table;
- tombstone immutability;
- proposal/audit linkage;
- advisory locking;
- pending-proposal conflict;
- Google identity conflict;
- third-party alias conflict;
- promoted relationship conflict;
- route self-loop protection;
- projected route duplicate protection;
- association-edge redirection;
- route endpoint redirection;
- data-issue redirection;
- promoted-alias redirection;
- source candidate snapshots;
- dual-control proposal;
- canonical merge audit;
- stale-state protection;
- dual-control audit metadata;
- protected merge endpoint;
- operational tombstone filtering;
- auth kill switch;
- public Web exclusion.

## Exact PostGIS migration proof

Authoritative clean disposable database:

`tn7-adj7-db-Oyeg`

Setup service:

`tn7-adj7-db-setup-nYEz`

Clean reset deployment:

`da910072-d258-4b8d-b6f7-cb732ac7ede7`

Result:

**TN7_ADJ7_DB_SETUP_PASS**

Exact committed migrations applied in order:

1. `005_operator_audit.sql`
2. `006_data_issue_rejected_status.sql`
3. `007_two_person_decision_proposals.sql`
4. `008_transport_entity_aliases.sql`
5. `009_rank_association_promotions.sql`
6. `010_route_candidate_promotions.sql`
7. `011_taxi_rank_merge_foundation.sql`

The setup harness is intentionally create-from-scratch. A dirty reset attempt was discarded after it hit the pre-existing enum type; the database was replaced and the authoritative run above started from a fresh PostGIS instance.

No production PostGIS migration was executed.

## Isolated merge API

Service:

`tn7-adj7-api-ykIh`

Final deployment:

`5d747621-6a8f-426c-863f-8fdb10ab8571`

Status:

**SUCCESS**

Enabled only in the disposable environment:

- `OPERATOR_DUAL_CONTROL_ENABLED=true`
- `OPERATOR_RANK_MERGE_ENABLED=true`

All direct one-person mutation switches remained off.

## Runtime merge proof

Service:

`tn7-adj7-smoke-eAO_`

Authoritative successful deployment:

`03910b02-79f5-4353-b9aa-ae0607b2da6b`

Result:

**TN7_ADJ7_RUNTIME_PASS**

An earlier smoke run successfully performed the merge but used the wrong test URL (`/api/v1/ranks/map`) for the tombstone visibility assertion. That run was discarded. The disposable database was replaced, the test was corrected to the canonical `/api/v1/ranks` endpoint, and the complete suite was rerun from zero.

### Access and core conflict proof

- anonymous merge proposal → **401**
- survivor==duplicate → **409**
- conflicting Google Place IDs → **409 rank_merge_google_place_conflict**
- third-party alias collision → **409 rank_merge_alias_collision**
- route survivor↔duplicate self-loop projection → **409 rank_merge_route_self_loop_conflict**
- Reviewer cannot approve → **403**

### Successful canonical merge

Survivor:

`Merged Central Rank`

Duplicate:

`Old Central Taxi Rank`

Independent approval succeeded.

Proven:

- duplicate points to survivor through `merged_into_rank_id`;
- duplicate stores proposal and canonical merge audit IDs;
- duplicate canonical name transferred to survivor aliases;
- duplicate aliases `Old Central` and `OCR` transferred;
- overlapping Alpha association relationship collapsed;
- non-overlapping Beta relationship redirected to survivor;
- duplicate has no active canonical association edges;
- canonical route origin redirected to survivor;
- duplicate has no canonical route edges;
- active rank data issue redirected to survivor;
- duplicate has no active data issues;
- rank-association candidate evidence remained on duplicate UUID;
- taxi-rank source record remained on duplicate UUID;
- durable merge lineage links survivor, duplicate and proposal;
- lineage records relationship redirect counts;
- exactly one canonical `taxi_rank.merge` audit exists.

### Operational tombstone visibility

After merge:

- `GET /api/v1/ranks?province=Gauteng` does not return the duplicate tombstone;
- active rank detail for the duplicate returns **404**.

The tombstone remains queryable through direct database lineage/evidence, not normal operational rank exploration.

### Idempotent approval replay

Same Approver + same approval idempotency key:

- safe replay;
- no second merge audit.

### Tombstone immutability

Direct SQL UPDATE of merged duplicate:

**blocked**

Direct SQL DELETE of merged duplicate:

**blocked**

### Stale graph proof

A merge proposal was created for a separate survivor/duplicate pair.

An affected rank data-issue record was changed after proposal creation.

Approval:

**409 decision_proposal_stale_before_state**

Duplicate remained active.

### Concurrent proposal serialization

Two Reviewers attempted to create proposals concurrently for the same survivor/duplicate pair.

Result:

- exactly one proposal created;
- exactly one request returned conflict;
- winning proposal could be independently approved;
- duplicate became a tombstone once.

### Atomic rollback

A clean proposal was created for another survivor/duplicate pair.

A disposable CHECK constraint forced final `decision_proposal.approve` audit insertion to fail after merge work began.

Result:

- API returned server error;
- duplicate tombstone marking rolled back;
- rank↔association redirect rolled back;
- route endpoint redirect rolled back;
- data-issue redirect rolled back;
- merge-lineage insertion rolled back;
- canonical merge audit rolled back;
- proposal status rolled back to `proposed`.

Proof marker:

**TN7_ADJ7_ATOMIC_MERGE_ROLLBACK_PASS**

### Audit ordering

All generated operator audit events remained strictly monotonic.

Result:

**TN7_ADJ7_AUDIT_SEQUENCE_PASS 9**

Disposable active inventory after successful proof merges:

- active ranks: **33**
- canonical routes: **5**

## Normal TN7 preview

API deployment:

`5c568199-5494-4a20-862d-2cc762450076`

Web deployment:

`97e0c897-dc10-402a-8c99-80508da8cff6`

Both are **SUCCESS** on runtime head `2483d743...`.

Normal preview variables contain none of:

- `OPERATOR_DEFER_ISSUE_ENABLED`
- `OPERATOR_REJECT_ISSUE_ENABLED`
- `OPERATOR_REOPEN_ISSUE_ENABLED`
- `OPERATOR_DUAL_CONTROL_ENABLED`
- `OPERATOR_ALIAS_PROMOTION_ENABLED`
- `OPERATOR_ASSOCIATION_ASSIGNMENT_ENABLED`
- `OPERATOR_ROUTE_PROMOTION_ENABLED`
- `OPERATOR_RANK_MERGE_ENABLED`

## Preview fail-closed proof

Guard service:

`tn7-adj7-preview-guard`

Deployment:

`99c235a4-bd31-454d-82db-90a9f4e6e262`

Result:

**TN7_ADJ7_PREVIEW_GUARD_PASS**

Proof:

- valid Reviewer rank-merge proposal → **503 rank_merge_disabled**
- valid Approver proposal approval → **503 dual_control_disabled**
- operator capabilities report rank merge disabled;
- zero enabled mutation actions;
- public Web merge proposal POST → **405**
- public Web proposal GET → **404**
- live network inventory unchanged:
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

No production canonical edge was redirected.

No production tombstone was created.

TN6 production services remain unchanged.

## Next recommended gate

**TN7-ADJUDICATION-8 — Merge Resolution & Operator Workbench Integration**

Before association merge, integrate the now-proven rank-merge foundation into the private quality workbench:

- show survivor vs duplicate side-by-side;
- map both coordinates and source evidence;
- show alias/Google identity comparison;
- show projected relationship and route redirects;
- surface self-loop/duplicate-route/alias conflicts before proposal;
- show source evidence that will remain on tombstone;
- proposal/approval timeline and immutable audit;
- merged-tombstone redirect banner in authenticated operator views;
- no public mutation surface;
- activation remains default-off.

Association merge should remain a later, separately gated operation because it redirects substantially more routes, ranks and ownership semantics.
