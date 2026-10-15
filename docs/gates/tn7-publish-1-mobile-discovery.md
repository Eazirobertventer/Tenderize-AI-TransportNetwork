# TN7-PUBLISH-1 — Mobile discovery publication boundary

This gate adds a dedicated consumer publication surface for FairPay Find Taxi. It is separate from the operational map, evidence, reconciliation, and adjudication APIs.

## Endpoint

`GET /api/v1/publication/mobility/find-taxi`

The response is the strict `fairpay-transport-discovery` document used by the Mobility Wallet BFF. It contains only canonical rank, route, and Association identity plus optional canonical rank coordinates and consumer display labels.

## Eligibility

A route is emitted only when its route, origin rank, destination rank, Association, and both endpoint-to-Association relationships are in one of `official`, `verified`, `documented`, or `community_verified`; neither endpoint nor the Association is a merge tombstone; both canonical endpoint ids and an Association id are present; and the route has `route_candidate_promotion` lineage to an approved `taxi_route.promote` decision. Legacy canonical rows without this controlled approval lineage remain withheld.

Coordinates are published only when the canonical rank point is present and valid. Missing coordinates remain absent. No geocoder or Google service is called.

## Identity

`taxi_rank.id`, `taxi_route.id`, and `taxi_association.id` are emitted as opaque publication tokens. Labels, aliases, and route codes are never identity keys.

## Authentication

The endpoint has a service-only Bearer boundary independent from operator authentication. Its audience is `transport-network-discovery` and its required scope is `transport.discovery.read`. `DISCOVERY_JWT_SECRET` is intentionally separate from `OPERATOR_JWT_SECRET`. With no discovery secret configured the endpoint fails closed with `503 discovery_auth_unconfigured` before querying the database.

No production service identity or secret is created by this gate.

## Out of scope

This endpoint does not publish fare, taxis, vehicles, drivers, seats, ETA, route geometry, source evidence, adjudication state, audit records, confidence, contact details, or data-quality issues. It performs no mutations and does not alter production deployment or Railway configuration.
