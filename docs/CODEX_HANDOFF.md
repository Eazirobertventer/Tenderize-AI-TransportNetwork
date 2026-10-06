# Codex handoff — TN2/TN3

## Current gate

**TN0/TN1 PASS — local repository bootstrap, data contract, offline prototype and source adapters created.**

Current local head at handoff is recorded in the final delivery note; verify it before making mutations.

## Next Codex objective

Build TN2/TN3 without weakening the current provenance and route-classification rules.

### Required work

1. Introduce a production web app in `apps/web` using Next.js + TypeScript.
2. Use MapLibre GL JS for the national map shell. Do not use NextBillion.
3. Introduce `apps/transport-api` with a typed read API over Postgres/PostGIS.
4. Apply `db/001_initial.sql` to a disposable PostGIS database first.
5. Add a repository-layer boundary; the UI must never connect directly to Postgres.
6. Load `data/ingested/*.json` through an explicit import command that records `ingestion_run` and `source_record` lineage.
7. Implement the Ekurhuleni rank adapter first. The adapter must split repeated association and destination fields into candidates; it must not silently create canonical association identities when strings are ambiguous.
8. Implement Cape Town route ingestion with official geometry but leave rank links unresolved until reconciliation can prove the origin/destination mapping.
9. Treat the KZN configured route layer as `official_legacy` / documented evidence, not proof of current operations.
10. Add map bounding-box query, clustering, province filter, rank drawer and source badges.
11. Keep seed/prototype inferred edges visually and semantically distinct from registered/documented routes.
12. Add tests for:
    - no candidate/inferred route promoted to official;
     - no coordinate-less rank accepted as geospatially verified;
     - repeated Ekurhuleni association fields are normalised without destructive merge;
    - empty ingestion cannot delete last-good canonical data;
     - source lineage is mandatory for every imported record;
    - Google enrichment persists Place IDs only, not a bulk mirror of Google content.

### Explicit non-goals

- No FairPay production integration yet.
- No live vehicle tracking yet.
- No route ETA engine yet.
- No production deployment yet.
- No automatic association/rank merge based solely on fuzzy name or proximity.

### Exit criteria

TN2/TN3 PASS requires:

- green tests;
- disposable PostGIS migration proof;
- working MapLibre national map using ingested official rank data;
- evidence/source badge visible on rank details;
- ingestion does not overwrite/delete canonical records on empty source responses;
- exact commit SHA reported;
- no merge/deployment without owner approval.
