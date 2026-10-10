# TN7-ADJUDICATION-7 — Controlled Canonical Taxi-Rank Merge Foundation

Date: 2026-10-08

## Verdict

**PASS — controlled canonical taxi-rank merge is proven behind the ADJ3 two-person approval foundation.**

Validated runtime head:

`3a892f7f6cebd102dab4e91218575a7f60be8f3f`

Branch:

`phase/tn7-transport-network-operations`

Draft PR:

`#10 — TN7: Transport Network Operations & Data Completion foundation`

## Scope

ADJ7 implements **taxi-rank merge only**.

The operator explicitly chooses:

- survivor rank;
- duplicate rank.

The duplicate row is not deleted. It becomes a durable, immutable tombstone that points to the survivor.

Association merge, route merge and automatic survivor selection remain unsupported.

## Proposal endpoint

`POST /api/v1/operator/proposals/rank-merges`

Proposal roles:

- reviewer;
- approver;
- admin.

Approval remains:

`POST /api/v1/operator/proposals/:proposalId/approve`

A different Approver/Admin subject is required by the ADJ3 dual-control foundation.

## Migration 011

Committed migration:

`db/011_taxi_rank_merge_foundation.sql`

Adds merge fields to `taxi_rank`:

- `merged_into_rank_id`;
- `merged_at`;
- `merge_proposal_id`;
- `merge_audit_event_id`.

Adds durable lineage table:

`taxi_rank_merge_lineage`

Lineage records:

- survivor rank;
- duplicate rank;
- proposal;
- canonical merge audit;
- survivor pre-state;
- duplicate pre-state;
- post-merge state;
- redirect counts;
- merge timestamp.

Merged tombstones are protected by a database trigger:

- UPDATE blocked;
- DELETE blocked.

## Frozen merge graph

The proposal SHA-256 snapshot covers both ranks and all merge-relevant state:

- canonical identity and aliases;
- location/location hash;
- Google Place identity;
- canonical rank↔association relationships;
- canonical routes using either rank;
- rank-association source candidates;
- rank-destination source candidates;
- route candidates;
- rank source records;
- rank data issues;
- promoted aliases;
- pending rank proposals;
- existing merge lineage.

Any material graph change makes approval stale.

## Source-provenance policy

Canonical operational edges move to the survivor.

Historical source evidence remains attached to the duplicate tombstone UUID:

- `rank_association_candidate`;
- `rank_destination_candidate`;
- rank `source_record`.

This preserves source lineage as originally observed.

## Conflict policy

Merge fails closed for:

- survivor == duplicate;
- survivor already a tombstone;
- duplicate already merged;
- other pending rank-targeted proposals;
- conflicting non-null Google Place IDs;
- third-party canonical-name/alias collision;
- promoted duplicate-side association relationship requiring lineage rewrite;
- route that would become survivor→survivor;
- projected duplicate canonical route after endpoint redirection.

## Deterministic merge behavior

A valid merge can:

- transfer duplicate canonical name and safe aliases to survivor;
- redirect promoted alias registry rows;
- collapse overlapping rank↔association pairs;
- redirect non-overlapping association relationships;
- redirect canonical route origin/destination endpoints;
- redirect active rank data issues;
- mark duplicate as immutable tombstone;
- create durable merge lineage.

Route geometry is not regenerated.

## Operational visibility

Operational rank map/count/detail surfaces hide merged tombstones.

Filtering uses a schema-compatible `to_jsonb(...)->>'merged_into_rank_id'` pattern, so the current preview remains safe before migration 011 is applied.

## Static gate

Service:

`tn7-adj7-static-check`

Deployment:

`2616b92b-f47e-4515-bbdd-f28061960fc1`

Result:

**TN7_ADJ7_STATIC_PASS 27/27**

## Runtime evidence integrity

An earlier smoke attempt reached deploy state twice against one disposable database.

That run was explicitly **discarded** and none of its assertions were accepted.

For the authoritative runtime gate:

1. the ambiguous smoke service was deleted;
2. the disposable API/setup/database were deleted;
3. a completely fresh PostGIS, setup runner and merge API were provisioned;
4. migrations were applied once;
5. exactly one smoke deployment was launched.

The evidence below comes only from that clean stack.

## Exact PostGIS setup proof

Fresh disposable PostGIS:

`tn7-adj7-db`

Setup service:

`tn7-adj7-db-setup`

Deployment:

`e4dd3d40-539f-4f4c-ab51-ece4d0393c1d`

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

No production migration was executed.

## Isolated merge API

Service:

`tn7-adj7-api`

Deployment:

`b78abae1-8ae8-4f32-8e53-9f94f505b2e1`

Status:

**SUCCESS**

Enabled only in this disposable environment:

- `OPERATOR_DUAL_CONTROL_ENABLED=true`
- `OPERATOR_RANK_MERGE_ENABLED=true`

All other direct mutation switches remained off.

## Authoritative runtime proof

Service:

`tn7-adj7-smoke`

Deployment:

`5b96e243-488f-4303-bd20-252ac760a8c9`

Status:

**SUCCESS**

Result:

**TN7_ADJ7_RUNTIME_PASS**

### Validation and conflict proof

Runtime assertions passed for:

- anonymous merge proposal rejected;
- same survivor/duplicate rejected;
- conflicting Google Place identities blocked;
- third-party alias collision blocked;
- route self-loop projection blocked;
- Reviewer unable to approve merge.

### Successful merge proof

Independent Approver executed a valid merge.

Proven:

- duplicate becomes tombstone pointing to survivor;
- tombstone links proposal and canonical merge audit;
- duplicate canonical name + aliases transfer to survivor;
- overlapping association link collapses;
- non-overlapping association link redirects;
- duplicate has no active canonical association edges;
- canonical route endpoint redirects to survivor;
- duplicate has no canonical route edges;
- active rank issue redirects to survivor;
- duplicate has no active data issues;
- source candidate/source-record evidence remains anchored to duplicate tombstone UUID;
- durable merge lineage links survivor, duplicate and proposal;
- lineage stores redirect counts;
- canonical merge audit exists exactly once;
- operational rank map hides tombstone;
- active rank detail returns 404 for tombstone.

### Idempotent replay

Same Approver + same approval key:

- safe replay;
- no second canonical merge audit.

### Tombstone immutability

Direct SQL UPDATE of merged tombstone:

**blocked**

Direct SQL DELETE of merged tombstone:

**blocked**

### Stale-state proof

A merge proposal was created.

Frozen graph state was changed afterward.

Approval was rejected as stale and the duplicate remained active.

### Concurrent proposal proof

Two Reviewers attempted proposals for the same survivor/duplicate pair concurrently.

Result:

- exactly one pending proposal survives;
- competing proposal conflicts;
- the serialized winning proposal can be approved;
- duplicate becomes tombstone once.

### Atomic rollback proof

A final proposal-approval audit failure was deliberately induced.

All merge side effects rolled back:

- tombstone marking;
- association relationship redirection;
- route redirection;
- data-issue redirection;
- merge-lineage insertion;
- canonical merge audit;
- proposal approval state.

Proof marker:

**TN7_ADJ7_ATOMIC_MERGE_ROLLBACK_PASS**

### Audit ordering

Result:

**TN7_ADJ7_AUDIT_SEQUENCE_PASS 9**

Disposable active-count marker:

`TN7_ADJ7_ACTIVE_COUNTS {"ranks":33,"routes":5}`

These are disposable fixture counts, not production counts.

## Normal TN7 preview

Current-head API:

`3c3d932a-b93b-4fde-b7f1-0abffe5c7a4b`

Status:

**SUCCESS**

Current-head Web:

`fcdc3a24-a7e6-4a7f-8fa5-cd82feb7b6bc`

Status:

**SUCCESS**

Normal preview has none of these mutation switches enabled:

- defer;
- reject;
- reopen;
- dual control;
- alias promotion;
- association assignment;
- route promotion;
- rank merge.

## Preview fail-closed proof

Guard service:

`tn7-adj7-preview-guard`

Deployment:

`16021b0e-0352-4ad3-811c-9da447977c7d`

Status:

**SUCCESS**

Result:

**TN7_ADJ7_PREVIEW_GUARD_PASS**

Proven:

- valid Reviewer rank-merge proposal → **503 rank_merge_disabled**
- valid Approver proposal approval → **503 dual_control_disabled**
- capabilities report rank merge disabled;
- zero enabled mutation actions;
- public Web merge POST → **405**
- public Web proposal GET → **404**
- live TN7 preview counts unchanged:
  - ranks: **744**
  - associations: **35**
  - routes: **1,761**
  - rank-association candidates: **29**

## Production status

**No production mutation.**

Migrations 005 through 011 remain unapplied to production PostGIS.

No production taxi rank was merged.

No production route or association edge was redirected.

TN6 production services remain unchanged.

## Scope boundary

ADJ7 does not enable:

- association merge;
- route merge;
- automatic survivor selection;
- source-evidence rewriting;
- destructive deletion of merged rank identities.

## Next recommended phase

Before enabling any high-impact adjudication against non-disposable data:

1. integrate proposal/merge diffs into the authenticated Data Quality Workbench;
2. provide side-by-side survivor vs duplicate inspection:
   - map/satellite context;
   - aliases;
   - associations;
   - routes;
   - source evidence;
   - open issues;
   - conflicts;
3. run a dedicated migrations 005→011 staging/readiness gate;
4. keep every production mutation switch disabled until that gate passes.
