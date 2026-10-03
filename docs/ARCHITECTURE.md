# Tenderize Transport Network — Architecture

## Purpose

Create a reusable national transport graph for Tenderize products. The canonical relationship is not a simple rank-to-rank line; every edge preserves the operating association, provenance, verification state and geometry status.

```text
Province / Municipality
        ↓
     Taxi Rank ←──────── Taxi Association
        │                       │
        └──────── Taxi Route ───┘
                    │
                    ↓
             Destination Rank
```

## Design principles

1. **Official-first ingestion.** Municipal/provincial GIS and NLTIS/OLAS are preferred canonical inputs.
2. **Provenance is first-class.** Every canonical entity can retain many source records.
3. **No false certainty.** Official/documented/inferred are separate states. An inferred road path is never promoted to a registered taxi route without evidence.
4. **Coordinates are evidence, not identity.** Nearby points may be duplicates but are never silently merged.
5. **Google is enrichment, not the master store.** Store Google Place IDs and permitted derived metadata; do not build a bulk Google Maps content mirror.
6. **PostGIS is the canonical geospatial store.** Spatial queries, proximity, bounding boxes and route geometry all live in PostGIS.
7. **Shared Tenderize service.** FairPay portals, the mobile wallet and later platforms consume the same API rather than each maintaining their own taxi-location dataset.

## Logical services

### transport-api
Read API for ranks, associations, routes, map tiles/GeoJSON envelopes and network queries.

### ingestion-worker
Pulls ArcGIS/GeoJSON/CSV/KML sources, records raw lineage, normalises fields and submits candidates for reconciliation.

### reconciliation-worker
Detects name/coordinate/source conflicts. Suggested matches require explicit confidence thresholds and review for destructive merges.

### network-engine
Builds a directed multi-graph where multiple associations/routes may connect the same pair of ranks. Supports direct-route and transfer search while preserving evidence classification per leg.

### enrichment-worker
Optional Google Places and OSM verification. Never overwrites authoritative source data without a reconciliation decision.

## Gate sequence

- TN0 — repository, architecture, safety rules
- TN1 — PostGIS model + source registry
- TN2 — interactive national map shell
- TN3 — official rank ingestion
- TN4 — association ingestion/reconciliation
- TN5 — route geometry ingestion
- TN6 — rank/association/route detail UI
- TN7 — network graph + journey search
- TN8 — Google Place-ID verification/enrichment
- TN9 — data quality/admin console
- TN10 — FairPay shared API integration
- TN11 — mobile wallet integration
- TN12 — production hardening, observability, backups and deployment
