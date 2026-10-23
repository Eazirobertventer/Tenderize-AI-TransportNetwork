# TN7 — Transport Network Operations & Data Completion

## Product purpose

Tenderize Transport Network must become an operational national taxi-network map that lets an authorised operator answer four questions quickly:

1. Where is every taxi association?
2. Where is every taxi rank?
3. What routes connect those ranks and associations?
4. What does the physical street environment around a rank or route point look like?

The production-safe TN6 data foundation remains authoritative. TN7 builds operator workflows and national coverage on top of it without weakening provenance, source isolation, or the public/private API boundary.

## Non-negotiable TN7 outcomes

- National map of taxi ranks, associations and route evidence.
- Province → municipality/city → association → rank → route drill-down.
- Street, satellite and street-level imagery workflows.
- From a mapped rank, an operator can open Street View at the exact coordinate where imagery is available and move through the surrounding streets.
- From route endpoints, an operator can inspect the origin/destination area at street level.
- Association geography is represented conservatively:
  - use an authoritative association coordinate when available;
  - otherwise show a derived centroid/coverage footprint from linked verified ranks;
  - never imply a derived centroid is an official office location.
- Route layers continue to distinguish canonical geometry, official source geometry, candidates and endpoint-only evidence.
- Ambiguous data must be reviewable without silently becoming canonical truth.
- Every manual adjudication eventually requires trusted operator identity and an immutable audit record.

## TN7-A — Data Quality Workbench

### A1 — Workbench foundation
- Aggregate quality summary for mapped/unmapped ranks, open issues, unresolved association labels and unassigned route candidates.
- Private read-only queue contracts for:
  - data issues;
  - unresolved/ambiguous endpoint labels;
  - rank ↔ association candidates;
  - route ↔ association evidence.
- Public UI may show aggregate counts only.
- Detailed work queues remain behind the private API until operator authentication is enabled.

### A2 — Operator authentication and authorisation
- Trusted operator session.
- Explicit roles for reviewer/approver/admin.
- No browser-shipped static admin token.
- Mutation endpoints reject unauthenticated and unauthorised callers.

### A3 — Adjudication actions
- Approve.
- Reject.
- Merge.
- Add alias.
- Defer.
- Resolve issue.
- Every action records actor, timestamp, before/after state, evidence reviewed and decision rationale.
- Idempotency and cross-entity integrity checks required.

### A4 — Review UX
- Queue filters by province, municipality, association, source, severity and issue type.
- Side-by-side source evidence.
- Map context for the affected rank/route.
- Satellite and Street View links for location adjudication.
- Bulk operations only where decision semantics are deterministic and reversible.

## TN7-B — National Coverage Expansion

### B1 — Coverage dashboard
- Province-level ranks, mapped ranks, associations, routes and sources.
- Municipality/city drill-down.
- Coverage completeness indicators.
- Location-pending counts.
- Source freshness visibility.

### B2 — Province-by-province source expansion
Target all nine provinces:
- Gauteng
- KwaZulu-Natal
- Western Cape
- Eastern Cape
- Free State
- Limpopo
- Mpumalanga
- North West
- Northern Cape

For every source:
- record authority;
- source class;
- coverage;
- retrieval timestamp;
- source record identity;
- official/documented/inferred classification;
- fail closed on empty or materially incomplete responses.

### B3 — Association completeness
- Expand association registry.
- Registration/acronym/alias normalisation.
- Association ↔ rank evidence.
- Association ↔ route evidence.
- Municipality/province attribution.
- Never infer an office location from rank centroid without labelling it as derived coverage.

### B4 — Rank completeness
- Expand mapped rank inventory.
- Resolve duplicate/alias rank identities.
- Track documented ranks with missing coordinates separately.
- Satellite QA for candidate locations.

### B5 — Route completeness
- Add authoritative route geometry where available.
- Preserve official source geometry separately from canonical route geometry.
- Reconcile route endpoints to canonical ranks.
- Assign association ownership only with sufficient evidence.
- Never convert endpoint connectors into travelled road paths.

## TN7-C — Operational Map v2

### C1 — Map exploration foundation
- Rank markers with labels and clustering.
- Association markers/coverage centroids.
- Route overlays.
- Province/city filters.
- Association filtering.
- National search.
- Street and satellite basemaps.
- Drill-down details for rank, association and route.

### C2 — Street-level inspection
- Every mapped rank exposes:
  - Street View;
  - standard map;
  - satellite verification.
- Street View opens at the selected coordinate using Google Maps panorama mode where imagery exists.
- Operator can navigate/walk through surrounding streets using the Street View interface.
- Route origin/destination points expose equivalent street-level entry points.
- No claim that Street View imagery is current; imagery date/availability is controlled by the provider.

### C3 — Association geography
- Map every association with either:
  - authoritative association coordinate; or
  - clearly-labelled linked-rank centroid.
- Show linked rank count, route count, province, municipality and registration number.
- Click association → highlight its ranks and routes.

### C4 — Route exploration
- Click route → show origin, destination, association, source and evidence state.
- Fit map to route geometry.
- Origin/destination Street View actions.
- Clear visual distinction between:
  - canonical routes;
  - official source geometry;
  - exact route candidates;
  - NLTIS endpoint connectors.

### C5 — Operational layers
- Source/freshness layer.
- Missing-coordinate layer.
- Data-quality layer.
- Candidate/ambiguity layer.
- Coverage heatmap by province/municipality.
- Optional imagery verification state.

## Phase gates

### TN7-FOUNDATION
Deliver A1 + B1 + C1/C2 foundations:
- quality summary;
- coverage endpoint;
- association geography endpoint/layer;
- Street View from mapped ranks;
- route endpoint Street View entry points where coordinates are available;
- no mutation endpoints exposed publicly.

### TN7-AUTH
Deliver trusted operator identity before any adjudication mutations.

### TN7-ADJUDICATION
Deliver audited approve/reject/merge/alias/defer workflow.

### TN7-NATIONAL
Iteratively expand authoritative coverage across all nine provinces.

### TN7-MAP-V2
Complete association filtering, coverage views, route exploration and street-level operational workflows.

## Production safety constraints

- TN6 production release remains the rollback baseline.
- No schema mutation is performed by application startup.
- New database migrations are additive and reviewed separately.
- Public Web proxy remains an explicit allow-list.
- Internal quality details and mutation endpoints remain private until operator auth exists.
- No automatic canonical association/route ownership from weak or ambiguous evidence.
- All source-derived or calculated geographic positions must be labelled by evidence class.
