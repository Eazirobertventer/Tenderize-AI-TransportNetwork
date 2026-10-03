# Tenderize Transport Network

National taxi-rank, association and route intelligence foundation for South Africa.

This repository contains a runnable **TN0/TN1 prototype** plus the production data model and first official ArcGIS ingestion adapters.

## What works now

- Interactive national prototype with rank markers, province filtering, source/status filtering, rank detail drawer and route/source panels.
- Explicit distinction between official, documented, candidate and inferred data.
- PostGIS-ready canonical schema for ranks, associations, routes, source lineage, data issues and ingestion runs.
- Live ArcGIS ingestion adapter for configured public Feature/MapServer layers.
- Initial source configuration for Ekurhuleni taxi ranks, Cape Town taxi routes and a KZN taxi-route layer.
- Offline data validation gate.

## Run the prototype

Requires Node 20+.

```bash
npm run preview
```

Open `http://localhost:4173`.

No package installation is required for the prototype.

## Validate seed data

```bash
npm test
```

## Pull live ArcGIS data

When running in an environment with internet access:

```bash
npm run ingest -- ekurhuleni-taxi-ranks
npm run ingest -- capetown-taxi-routes
npm run ingest -- kzn-taxi-routes-legacy
```

Omit an ID to ingest all configured sources:

```bash
npm run ingest
```

Normalised output is written to `data/ingested/` and intentionally gitignored. Raw source lineage should ultimately be persisted in Postgres rather than committed to Git.

## Enrich with Google Place IDs

Google is deliberately treated as a verification layer rather than the canonical national dataset. Configure an API key and run:

```bash
GOOGLE_MAPS_API_KEY=... npm run enrich:google
```

The worker uses Google place names/locations transiently to score matches but persists only the Place ID plus Tenderize-owned match metadata. Google Place IDs are exempt from normal caching restrictions and Google recommends refreshing IDs older than 12 months.

## Start local PostGIS

```bash
docker compose up -d postgis
psql "$DATABASE_URL" -f db/001_initial.sql
```

## Safety rules

- Never call a route official because two ranks can be connected by road.
- Never silently merge similarly named or nearby taxi ranks.
- Never overwrite higher-confidence source evidence with an empty/lower-confidence import.
- Preserve source lineage for every canonical record.
- Treat legacy route layers as historical/documentary evidence unless current operation is independently verified.
- Keep Google Places as verification/enrichment, not the canonical bulk dataset.

## Next build gate

**TN2/TN3:** replace the offline projection map with MapLibre, load official ingested ranks through `transport-api`, add bounding-box pagination, clustering and a review queue for rank reconciliation.
