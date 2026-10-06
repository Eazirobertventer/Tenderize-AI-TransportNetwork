# TN6-PROD-2 consolidated release branch and CI remediation

Date: 2026-10-06

## Verdict

PASS.

## Frozen release head

b8b9444e7d221edf692b2a229d3e26fb5541fbef

Branch:
gate/tn6-prod-release

PR:
#5 TN6-PROD: consolidated transport network release

## Consolidation completed

Release branch contains:
- TN6-Z evidence/documentary lineage through TN6-Z10
- final TN6-UI1 frontend/API state
- TN6-Z6 PostgreSQL placeholder repair
- retained PR #1 KZN association inventory/read-only worker utilities
- reconciled package scripts
- restored satellite QA guidance

## CI remediation completed

- prove-satellite-map-mode: PASS
- prove-route-ingest: PASS using deterministic fixture mode in CI
- prove-nltis-association-ingest: PASS using verified snapshot mode in CI
- prove-dormant-extractor: PASS
- prove-ui1: PASS
- postgis-migrations: PASS
- all other release checks: PASS

Final CI:
- total: 27
- success: 27
- failures: 0
- pending: 0

## External source workflow policy

The following remain manual-only source-availability proofs:
- TN6-Z1-R1 bounded external KZN PDF retrieval
- TN6-Z1-R2 authoritative mirror retrieval

Parser/fixture correctness remains blocking CI.

## Safety

mainWrites: 0
pullRequestMerges: 0
productionDeployments: 0
databaseWrites: 0
