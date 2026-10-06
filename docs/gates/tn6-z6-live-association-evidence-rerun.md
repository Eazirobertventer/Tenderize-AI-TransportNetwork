# TN6-Z6 live association evidence re-run after Z5

Date: 2026-10-06

## Verdict

PASS — observational re-run complete.

## Live counts

| Bucket | TN6-X | TN6-Z6 | Delta |
|---|---:|---:|---:|
| shared | 0 | 0 | 0 |
| origin-only | 38 | 40 | +2 |
| destination-only | 196 | 194 | -2 |
| conflicting | 8 | 21 | +13 |
| none | 803 | 790 | -13 |
| total | 1,045 | 1,045 | 0 |

Eligible for automatic assignment remains 0.

## Interpretation

The three new Z5 rank-association links improved endpoint evidence coverage:
- 13 additional route candidates moved out of the none bucket.
- conflict detection increased from 8 to 21 because more candidates now have association evidence on both endpoints but the associations differ.
- no candidate has the same unique association on both endpoints.

This reinforces the directional/documentary safety rule established in TN6-Z2/Z3: route association evidence must not be copied across both endpoints merely to create shared matches.

## API repair discovered during Z6

The first Z6 read against /api/v1/route-candidates/association-evidence returned HTTP 500.

Root cause:
- malformed PostgreSQL parameter placeholders in the TN6-UI1 route read endpoints
- province/bbox values were inserted as integer positions rather than $n bind markers

The transport-api read queries were corrected on gate/tn6-ui1-live-rank-evidence and redeployed.
After repair:
- association-evidence endpoint returned HTTP 200
- Z6 classifier completed successfully

No database mutation was involved in the API repair.

## Safety

associationWrites: 0
rankLinkWrites: 0
routeCandidateWrites: 0
canonicalRouteWrites: 0
