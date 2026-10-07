# TN7-ADJUDICATION-7 — Controlled Canonical Taxi-Rank Merge Foundation

Date: 2026-10-07

## Verdict

**PASS — two-person taxi-rank merge foundation is proven in isolated PostGIS with durable tombstones, graph conflict checks, canonical-edge redirection and full transactional rollback.**

Validated implementation/runtime head:

`f3d8a9d52caacb88485c38214278ae1a6f9e7d73`

Branch:

`phase/tn7-transport-network-operations`

Draft PR:

`#10 — TN7: Transport Network Operations & Data Completion foundation`

## Scope

ADJ7 implements **taxi-rank merge only**.

It does not implement:

- taxi-association merge;
- route merge;
- destructive deletion of duplicate rank identity;
- automatic fuzzy merge.

Proposal endpoint:

`POST /api/v1/operator/proposals/rank-merges`

Approval continues through:

`POST /api/v1/operator/proposals/:proposalId/approve`

A merge requires trusted identity, two-person approval, idempotency and:

`OPERATOR_RANK_MERGE_ENABLED=true`

No direct one-person merge endpoint exists.

## Durable tombstone model

The duplicate rank is **not deleted**.

Migration:

`db/011_taxi_rank_merge_foundation.sql`

adds:

- `merged_into_rank_id`
- `merged_at`
- `merge_proposal_id`
- `merge_audit_event_id`

and creates:

`taxi_rank_merge_lineage`

The duplicate UUID remains durable so historical source evidence continues to point to the identity actually observed upstream.

A database trigger makes an already merged tombstone immutable:

- UPDATE blocked;
- DELETE blocked.

## Frozen merge graph

The ADJ3 SHA-256 before-state freezes:

- survivor rank identity, aliases, geography and verification metadata;
- duplicate rank identity, aliases, geography and verification metadata;
- canonical rank↔association relationships;
- canonical routes touching either rank;
- rank-association candidate evidence;
- rank-destination candidate evidence;
- route candidates touching either rank;
- taxi-rank source records;
- rank data issues;
- promoted rank aliases;
- pending rank proposals;
- existing merge lineage;
- projected route self-loop / duplicate-route conflicts;
- third-party alias collisions.

A material graph change after proposal creation makes approval stale.

## Conservative conflict policy

Merge fails closed for:

- survivor == duplicate;
- survivor already a tombstone;
- duplicate already merged;
- another pending taxi-rank proposal touching either rank;
- conflicting non-null Google Place IDs;
- third-party canonical/legacy/promoted alias collision;
- ADJ5-promoted relationship on the duplicate;
- route survivor↔duplicate self-loop projection;
- projected duplicate canonical route after endpoint redirection.

ADJ7 does not auto-delete or auto-dedupe conflicting canonical routes.

## Canonical merge mutation

A valid approval executes in one PostgreSQL transaction:

1. lock proposal;
2. enforce different proposer/approver;
3. take deterministic survivor+duplicate advisory lock;
4. lock both rank rows;
5. reload the complete merge graph;
6. rerun all conflict checks;
7. verify frozen before-state SHA-256;
8. append immutable `taxi_rank.merge` audit;
9. transfer duplicate canonical name and safe legacy aliases to survivor;
10. redirect promoted rank aliases;
11. collapse overlapping unpromoted association links;
12. redirect remaining association links;
13. redirect canonical route origins/destinations;
14. redirect active taxi-rank data issues;
15. mark duplicate as immutable tombstone;
16. insert merge-lineage row with full pre/post snapshots and redirect counts;
17. refresh `rank_connectivity` materialized view when present;
18. approve proposal;
19. append proposal-approval audit;
20. commit.

Any failure rolls the complete transaction back.

## Source provenance

Source evidence is deliberately **not rewritten** to the survivor UUID.

The following remain tied to the duplicate tombstone where originally observed:

- taxi-rank `source_record` rows;
- rank-association candidates;
- rank-destination candidates;
- historical route-candidate/source evidence.

The durable tombstone + merge lineage explains resolution to the survivor without rewriting history.

## Operational tombstone visibility

Merged tombstones are hidden from primary operational rank surfaces.

The API uses schema-compatible `to_jsonb(...)->>'merged_into_rank_id'` predicates so code remains deployable before migration 011 exists.

Runtime proof confirmed:

- tombstone absent from rank map;
- active rank detail returns 404 for tombstone;
- active inventory excludes tombstones.

## Static gate

Service:

`tn7-adj7-static-check`

Deployment:

`e1e7480f-b563-40d9-850d-f8e2caf7ae3e`

Head:

`f3d8a9d52caacb88485c38214278ae1a6f9e7d73`

Result:

**TN7_ADJ7_STATIC_PASS 27/27**

Static checks covered tombstone/lineage schema, immutable tombstones, pair advisory locking, pending-proposal conflict, Google/alias/promoted-relationship conflicts, self-loop/duplicate-route checks, canonical edge redirects, source-evidence snapshots, dual-control proposal/audit integration, stale-state protection, operational tombstone filtering, kill switch and public-Web exclusion.

## Exact PostGIS migration proof

Disposable PostGIS:

`tn7-adj7-db`

Setup service:

`tn7-adj7-db-setup`

Deployment:

`ffba144e-cada-4354-942e-a281258b432e`

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

No production PostGIS migration was executed.

## Isolated merge API

Service:

`tn7-adj7-api`

Deployment:

`a01f91e3-62f8-41cd-a6d8-1e55b7b8753d`

Status:

**SUCCESS**

Enabled only in disposable proof:

- `OPERATOR_DUAL_CONTROL_ENABLED=true`
- `OPERATOR_RANK_MERGE_ENABLED=true`

All one-person mutation switches remained off.

## Runtime merge proof

Service:

`tn7-adj7-smoke`

Deployment:

`5ec3ce52-f4b3-4099-90ff-012bf9bb465a`

Result:

**TN7_ADJ7_RUNTIME_PASS**

### Access and conflict proofs

- anonymous proposal → **401**
- same survivor/duplicate UUID → **409**
- conflicting Google Place IDs → blocked
- third-party alias collision → blocked
- projected route self-loop → blocked
- Reviewer approval → **403**

### Successful canonical merge

Survivor:

`Merged Central Rank`

Duplicate:

`Old Central Taxi Rank`

Independent Approver approval succeeded.

Proven:

- duplicate tombstones to survivor;
- tombstone stores proposal and merge-audit IDs;
- duplicate canonical name and aliases transfer to survivor;
- overlapping Alpha relationship collapses;
- non-overlapping Beta relationship redirects;
- duplicate has no active canonical association edges;
- canonical route endpoint redirects to survivor;
- duplicate has no canonical route edges;
- active data issue redirects to survivor;
- duplicate has no active data issues;
- source candidate remains on duplicate UUID;
- source record remains on duplicate UUID;
- merge lineage links survivor/duplicate/proposal/audit;
- lineage stores redirect counts;
- exactly one canonical `taxi_rank.merge` audit exists.

### Operational visibility

After merge:

- duplicate omitted from operational rank map;
- duplicate active rank detail → **404**.

### Replay

Same approval idempotency key:

- safe replay;
- no duplicate canonical merge audit.

### Tombstone immutability

Direct SQL:

- UPDATE tombstone → blocked
- DELETE tombstone → blocked

### Stale graph

Proposal created, then an affected rank data-issue changed.

Approval:

**409 decision_proposal_stale_before_state**

Duplicate remained active.

### Concurrent proposal serialization

Two Reviewers concurrently proposed the same survivor/duplicate pair.

Result:

- exactly one proposal created;
- exactly one request conflicted;
- winning proposal could be approved;
- duplicate tombstoned once.

### Atomic rollback

A temporary disposable audit constraint forced final `decision_proposal.approve` audit insertion to fail after merge work began.

Result:

- tombstone marking rolled back;
- relationship redirect rolled back;
- route redirect rolled back;
- data-issue redirect rolled back;
- merge-lineage insert rolled back;
- canonical merge audit rolled back;
- proposal returned to `proposed`.

Proof:

**TN7_ADJ7_ATOMIC_MERGE_ROLLBACK_PASS**

### Audit ordering

**TN7_ADJ7_AUDIT_SEQUENCE_PASS 9**

Disposable active inventory after successful proof merges:

- active ranks: **33**
- canonical routes: **5**

## Normal TN7 preview

API deployment:

`d0b32771-7f34-4113-96dd-b5caea8ea0b3`

Web deployment:

`da2d3347-cb1a-4a18-b237-b61f2b3d0ac1`

Both:

**SUCCESS**

Normal preview has no rank-merge or dual-control switch enabled.

## Preview fail-closed proof

Guard:

`tn7-adj7-preview-guard`

Deployment:

`6cbc6190-7780-475b-bff4-88900d98b219`

Result:

**TN7_ADJ7_PREVIEW_GUARD_PASS**

Proof:

- valid Reviewer rank-merge proposal → **503 rank_merge_disabled**
- valid Approver proposal approval → **503 dual_control_disabled**
- capabilities report rank merge disabled and zero enabled mutation actions;
- public Web merge POST → **405**
- public Web proposal GET → **404**
- live inventory unchanged:
  - ranks: **744**
  - associations: **35**
  - routes: **1,761**
  - rank-association candidates: **29**

## Production status

**No production mutation.**

Migrations 005 through 011 remain unapplied to production PostGIS.

No production rank was merged or tombstoned.

No production canonical relationship or route endpoint was redirected.

TN6 production remains unchanged.

## Next recommended gate

**TN7-ADJUDICATION-8 — Merge Resolution & Operator Workbench Integration**

Before expanding merge to taxi associations, expose the proven rank-merge model safely inside the private Data Quality Workbench:

- survivor vs duplicate side-by-side;
- both locations on the operational map;
- canonical names, aliases and Google identity comparison;
- projected association/route redirects;
- conflict explanations before proposal;
- source evidence that remains on tombstone;
- proposal/approval/audit timeline;
- authenticated tombstone→survivor redirect view;
- no public mutation surface;
- activation remains default-off.

Association merge should remain separately gated because its route/ownership blast radius is materially larger.
