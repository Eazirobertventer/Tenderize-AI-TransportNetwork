# TN7-FOUNDATION Gate

Date: 2026-10-07

## Verdict

**PASS — foundation implementation is ready for review.**

This gate seeds all three TN7 streams without changing the TN6 production runtime:

- TN7-A: aggregate data-quality workbench foundation.
- TN7-B: national/province/municipality coverage foundation.
- TN7-C: association geography, satellite/street map exploration, and Street View entry points.

Base production SHA:

`78ce2a643fea61a401d1a79fa69bc3ccc9cda33f`

Branch:

`phase/tn7-transport-network-operations`

## Static safety gate

Disposable Railway check:

- service: `tn7-foundation-static-check`
- deployment: `4e450f08-54b3-43e9-a207-dc8e619b4daf`
- result: **SUCCESS**
- assertion result: **TN7_FOUNDATION_STATIC_PASS 15/15**

Checks included:

- JavaScript/Node syntax.
- Street View helper exists.
- Association map layer exists.
- Coverage UI loader exists.
- Safe public GET allow-list contains only TN7 aggregate/geography additions.
- Detailed `/api/v1/data-issues` remains outside the public Web allow-list.
- Roadmap includes street-level inspection, all-nine-province expansion, and operator-auth gating before adjudication mutations.

## Runtime preview

### API preview

- service: `tn7-api-preview`
- deployment: `f8c98268-4dfc-4170-9f0b-14bc54430819`
- result: **SUCCESS**
- mode: PostGIS
- database access: read-only GET requests only

### Web preview

- service: `tn7-web-preview`
- deployment: `337840cb-9722-4f00-a752-011f3880de26`
- result: **SUCCESS**
- API target: TN7 API preview over Railway private networking

### End-to-end smoke

- service: `tn7-foundation-smoke`
- deployment: `cda8e08a-a4db-4cb5-85ed-6bae9a60bc6b`
- result: **SUCCESS**
- marker: `TN7_FOUNDATION_RUNTIME_PASS`

Passed runtime assertions:

- API health: 200
- coverage: 200
- Gauteng municipality/city coverage: 200
- association geography: 200
- aggregate quality summary: 200
- Web health: 200
- Web coverage proxy: 200
- Web association geography proxy: 200
- Web aggregate quality proxy: 200
- Web detailed data issues: **404**
- Web index: 200
- served app contains Street View, association layer, and coverage implementation

## Current production data observed through TN7 read-only APIs

National:

- ranks: **744**
- mapped ranks: **704**
- location pending: **40**
- associations: **35**
- routes: **1,761**
- sources: **20**

Current province coverage response contains **3 provinces**. This is the baseline for TN7-B national expansion, not the target state.

Gauteng currently exposes **10 municipality/city coverage rows**.

## Association geography baseline

TN7 association map currently returns:

- mapped associations: **29**
- derived linked-rank centroids: **29**
- authoritative association locations: **0**

Therefore:

- derived association points are explicitly labelled as coverage centroids;
- they must never be presented as association offices;
- TN7-B association completion must acquire/verify authoritative association locations where available;
- the remaining six associations require sufficient geographic evidence before they can be plotted.

## Data-quality baseline

Aggregate-only quality endpoint returned:

- open/reviewing/deferred issues: **331**
- reviewing issues: **0**
- error/blocking open issues: **0**
- ranks missing coordinates: **40**
- ranks without canonical association link: **673**
- rank-association candidate observations: **29**
- unresolved association labels: **28**
- route candidates without association: **1,045**
- canonical routes without association: **1,447**
- routes with one or both canonical endpoints unresolved: **1,704**

This is the work queue TN7-A and TN7-B must reduce. No mutation capability is enabled in this gate.

## Street-level scope

Implemented foundation:

- mapped rank → Google Street View panorama entry at exact rank coordinate;
- mapped rank → Google Maps;
- route geometry → Street View start/end actions when geometry endpoints are available;
- satellite layer remains available for physical-facility inspection;
- Street View imagery is context only and does not upgrade canonical evidence.

Planned next:

- operator-authenticated adjudication;
- association filter/highlight workflow;
- authoritative association location capture;
- route-centric fit/highlight and endpoint inspection;
- street-level QA status/audit history.

## Security invariant

The public Web proxy exposes only:

- coverage aggregates;
- association map geography;
- aggregate data-quality summary.

Detailed data issues and future adjudication mutation APIs remain private until trusted operator authentication and authorisation are implemented.

## Production mutation

**None.**

TN6 production services, schema, worker sources, and canonical data were not modified by this gate.
