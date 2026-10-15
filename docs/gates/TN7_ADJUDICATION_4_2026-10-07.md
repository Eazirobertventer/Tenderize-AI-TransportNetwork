# TN7-ADJUDICATION-4 — Controlled Alias Promotion

Date: 2026-10-07

## Verdict

**PASS — controlled rank and association alias promotion is proven behind the ADJ3 two-person approval foundation.**

Validated implementation head:

`5daf401dd3a85f96cd533dab560c4a5415066f27`

Branch:

`phase/tn7-transport-network-operations`

Draft PR:

`#10 — TN7: Transport Network Operations & Data Completion foundation`

## Scope

ADJ4 activates one canonical identity mutation type in isolated proof only:

- `taxi_rank.alias.add`
- `taxi_association.alias.add`

It remains behind:

- trusted operator identity;
- ADJ3 two-person proposal/approval;
- default-off `OPERATOR_DUAL_CONTROL_ENABLED`;
- default-off `OPERATOR_ALIAS_PROMOTION_ENABLED`.

No normal TN7 preview or TN6 production mutation is enabled.

## Migration 008

Committed migration:

`db/008_transport_entity_aliases.sql`

Adds:

- `taxi_association.aliases text[]` for compatibility with rank alias behavior;
- database identity normalization function;
- generic `transport_entity_alias` registry;
- normalized alias uniqueness by entity type;
- alias-to-proposal linkage;
- alias-to-canonical-audit linkage.

## Identity normalization

Database normalization is authoritative:

1. Unicode **NFKC** normalization;
2. trim;
3. collapse whitespace;
4. lowercase.

Examples:

- `  Central   Hub  ` → alias `Central Hub`, normalized `central hub`;
- full-width `ＡＴＡ` → normalized `ata`.

The NFKC implementation was caught as missing during the first static pass and corrected before any mutation database was provisioned.

## Alias namespaces

Aliases are unique within their entity type:

- taxi-rank identities compete with taxi-rank canonical names and aliases;
- taxi-association identities compete with association canonical names, acronyms and aliases.

The same normalized string may exist once in each different entity namespace. Example: rank alias `ATA` can coexist with association acronym `ATA`.

## Collision protection

Proposal creation checks existing identity evidence.

Approval repeats the checks inside the mutation transaction.

Collision sources:

### Taxi ranks

- rank canonical names;
- legacy `taxi_rank.aliases`;
- promoted alias registry.

### Taxi associations

- association canonical names;
- association acronyms;
- association aliases;
- promoted alias registry.

Approval obtains a transaction-scoped PostgreSQL advisory lock over:

`entityType + normalizedAlias`

before rechecking collision state.

This serializes simultaneous attempts to claim the same normalized alias.

The alias registry also has a database unique index as the final backstop.

## Proposal lifecycle

Rank alias proposal:

`POST /api/v1/operator/proposals/ranks/:id/aliases`

Association alias proposal:

`POST /api/v1/operator/proposals/associations/:id/aliases`

Proposal requirements:

- Reviewer / Approver / Admin;
- idempotency key;
- alias;
- rationale;
- evidence;
- dual-control enabled;
- alias-promotion enabled.

Approval continues through the ADJ3 generic route:

`POST /api/v1/operator/proposals/:proposalId/approve`

Approval requires a different Approver/Admin subject.

Proposal rejection and withdrawal continue to use the ADJ3 lifecycle.

## Atomic canonical mutation

Successful alias approval executes in one PostgreSQL transaction:

1. lock proposal;
2. enforce different proposer / approver;
3. normalize proposed alias again;
4. acquire normalized-alias advisory lock;
5. lock canonical target entity;
6. verify frozen before-state SHA-256;
7. recheck canonical/alias/acronym collisions;
8. append alias to entity alias array;
9. append canonical alias audit event;
10. insert promoted alias registry row;
11. mark proposal approved and link canonical audit event;
12. append proposal-approval audit event;
13. commit.

Any failure rolls back all of those steps.

## Static gate

Service:

`tn7-adj4-static-check`

Final passing deployment:

`0f90f644-b25e-4790-80cc-76c66b609fd2`

Result:

**TN7_ADJ4_STATIC_PASS 24/24**

Proven:

- association alias column;
- NFKC database normalization;
- generic alias registry;
- normalized alias unique index;
- advisory locking;
- canonical-name collisions;
- legacy alias collisions;
- association acronym collisions;
- alias array synchronization;
- proposal creation;
- rank and association alias actions;
- alias kill switch;
- collision recheck at approval;
- stale-state protection;
- dual-control canonical audit;
- registry insert inside approval transaction;
- rank/association proposal routes;
- public Web exclusion.

## Exact migration proof

Disposable Postgres:

`tn7-adj4-db`

Setup service:

`tn7-adj4-db-setup`

Deployment:

`eb00af7a-5090-46c5-ac0c-525656958d30`

Result:

**TN7_ADJ4_DB_SETUP_PASS**

Exact committed migrations were applied in order:

1. `db/005_operator_audit.sql`
2. `db/006_data_issue_rejected_status.sql`
3. `db/007_two_person_decision_proposals.sql`
4. `db/008_transport_entity_aliases.sql`

Proof identity fixtures:

- taxi ranks: **6**
- taxi associations: **3**
- deterministic adjudication issues: **17**

No production PostGIS migration was executed.

## Isolated alias API

Service:

`tn7-adj4-api`

Deployment:

`0b73b857-7fd6-473f-82af-4bbd68ea1bbb`

Status:

**SUCCESS**

Enabled only in this disposable environment:

- `OPERATOR_DUAL_CONTROL_ENABLED=true`
- `OPERATOR_ALIAS_PROMOTION_ENABLED=true`

Direct one-person defer/reject/reopen switches remained absent/false.

## Runtime alias proof

Service:

`tn7-adj4-smoke`

Successful authoritative deployment:

`f2db82d2-8cb8-4490-ad78-1e8889b4ff20`

Result:

**TN7_ADJ4_RUNTIME_PASS**

### Access and validation

- anonymous alias proposal → **401**
- proposal without evidence → **400**
- one-character alias → **400**
- Reviewer cannot approve proposal → **403**

### Own canonical identity collision

Proposed alias:

`CENTRAL TAXI RANK`

against canonical target:

`Central Taxi Rank`

Result:

**409 alias_already_present_or_identity**

### Other canonical-name collision

Proposed normalized alias matching:

`West Taxi Rank`

Result:

**409 alias_collision**

Collision classified as:

`canonical_name`

### Legacy alias collision

Proposed normalized alias matching existing legacy rank alias:

`Central Rank`

Result:

**409 alias_collision**

Collision classified as:

`alias`

### NFKC/acronym collision

Proposed association alias:

`ＡＴＡ` (full-width compatibility characters)

Database normalization:

`ata`

Existing association acronym:

`ATA`

Result:

**409 alias_collision**

Collision classified as:

`acronym`

This proves compatibility-form normalization is active.

### Rank alias promotion

Proposal:

`  Central   Hub  `

Stored alias:

`Central Hub`

Normalized key:

`central hub`

Independent Approver approved it.

Result:

- rank alias array updated;
- one alias-registry row created;
- registry linked to proposal;
- registry linked to canonical mutation audit;
- canonical audit attributed to Approver;
- canonical audit marked `dualControl:true`;
- normalized alias retained in audit metadata.

### Promoted-alias collision

A different rank then attempted:

`CENTRAL HUB`

Result:

**409 alias_collision**

### Association alias promotion

Association:

`Alpha Taxi Association`

Promoted alias:

`Alpha Cabs`

Result:

- association alias array updated;
- one association alias-registry row created.

### Cross-type namespace proof

A rank proposed alias:

`ATA`

while association acronym `ATA` already existed.

Result:

**PASS**

The rank alias was promoted because rank and association identity namespaces are intentionally distinct.

### Stale target proof

An alias proposal was created for a rank.

The rank was then modified after proposal creation.

Approval:

**409 decision_proposal_stale_before_state**

- alias array remained unchanged;
- proposal remained pending.

### Proposal rejection

A valid alias proposal was independently rejected.

Result:

- proposal → `rejected`;
- canonical alias array unchanged;
- no alias registry row.

### Concurrent same-alias race

Two proposals were created before either approval:

- North rank → `Shared Hub`
- South rank → `shared HUB`

Both normalize to:

`shared hub`

Approvals were sent concurrently by different Approvers.

Result:

- exactly one approval → **200**
- exactly one approval → **409 alias_collision**
- exactly one registry row;
- exactly one target rank received the alias.

This proves the advisory-lock + recheck boundary closes the concurrent claim race.

### Approval replay

Replaying the successful rank alias approval with the same idempotency key:

- returns safe replay;
- no duplicate registry row;
- no duplicate canonical audit.

### Atomic rollback

A temporary disposable constraint forced the final `decision_proposal.approve` audit to fail after the alias mutation work had begun.

Result:

- API returned server failure;
- association alias array rolled back;
- alias registry insertion rolled back;
- canonical alias audit rolled back;
- proposal remained `proposed`.

Proof marker:

**TN7_ADJ4_ATOMIC_ALIAS_ROLLBACK_PASS**

### Database uniqueness backstop

A direct SQL attempt was made to insert a second taxi-rank registry entry for normalized alias:

`central hub`

Result:

**blocked by unique index**

Proof marker:

**TN7_ADJ4_ALIAS_UNIQUENESS_PASS**

### Audit ordering

All audit events remained strictly monotonic.

Result:

**TN7_ADJ4_AUDIT_SEQUENCE_PASS 17**

Final promoted aliases in disposable proof:

- taxi associations: **1**
- taxi ranks: **3**

## Normal TN7 preview

API deployment:

`d076d6cd-616a-4231-a09d-740d7a9553ad`

Web deployment:

`2371b851-ad63-4532-b694-ac07a9b5da60`

Both are **SUCCESS** on the ADJ4 implementation head.

Normal TN7 API variables contain none of:

- `OPERATOR_DEFER_ISSUE_ENABLED`
- `OPERATOR_REJECT_ISSUE_ENABLED`
- `OPERATOR_REOPEN_ISSUE_ENABLED`
- `OPERATOR_DUAL_CONTROL_ENABLED`
- `OPERATOR_ALIAS_PROMOTION_ENABLED`

## Normal preview fail-closed proof

Guard service:

`tn7-adj4-preview-guard`

Deployment:

`4408a335-1e25-4a63-bf39-2648d9deba41`

Result:

**TN7_ADJ4_PREVIEW_GUARD_PASS**

Proof:

- valid Reviewer rank-alias proposal → **503 alias_promotion_disabled**
- valid Reviewer association-alias proposal → **503 alias_promotion_disabled**
- private proposal read with dual-control disabled → **503 dual_control_disabled**
- capabilities report alias promotion disabled;
- zero enabled mutation actions;
- public Web proposal POST → **405**
- public Web proposal GET → **404**
- network inventory remained:
  - ranks: **744**
  - associations: **35**
  - routes: **1,761**
  - rank-association candidates: **29**

## Production status

**No production mutation.**

- migration 005 unapplied to production PostGIS;
- migration 006 unapplied to production PostGIS;
- migration 007 unapplied to production PostGIS;
- migration 008 unapplied to production PostGIS;
- no production rank alias added;
- no production association alias added;
- TN6 production services unchanged;
- normal TN7 alias/dual-control switches disabled.

## Next recommended gate

**TN7-ADJUDICATION-5 — Controlled Association Ownership Assignment**

Use the ADJ3 dual-control foundation to turn reviewed rank↔association evidence into canonical ownership/linkage.

Recommended safeguards:

- proposal from a specific `rank_association_candidate` or equivalent evidence package;
- freeze rank, association, existing canonical links and evidence state;
- independent Approver;
- prevent duplicate link;
- conflict detection when evidence points to multiple associations;
- distinguish primary/operating association semantics before mutation;
- stale-state hash over rank + association + current relationship set;
- atomic relationship insert/update + canonical audit + proposal approval audit;
- self-approval denial;
- idempotent replay;
- concurrent competing-association approval proof;
- full rollback proof;
- default-off preview/production switch.
