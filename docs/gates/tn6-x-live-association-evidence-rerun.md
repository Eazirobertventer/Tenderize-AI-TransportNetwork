# TN6-X re-run KZN association evidence

Date: 2026-10-05

Read-only reclassification after TN6-W.

## Live counts

| Bucket | TN6-M | TN6-X | Delta |
|---|---:|---:|---:|
| shared | 0 | 0 | 0 |
| origin-only | 0 | 38 | +38 |
| destination-only | 23 | 196 | +173 |
| conflicting | 0 | 8 | +8 |
| none | 1,022 | 803 | -219 |
| total | 1,045 | 1,045 | 0 |

Eligible for automatic assignment remains 0.

## Interpretation

The five new rank-association links materially improved evidence coverage:
- 219 route candidates moved out of the none bucket.
- 38 now have origin-only association evidence.
- 196 now have destination-only association evidence.
- 8 have association evidence on both ends but it conflicts.
- 0 have the same unique association on both endpoints.

Therefore no route_candidate association assignment is safe yet.

## Safety

association writes: 0
routeCandidateWrites: 0
canonicalRouteWrites: 0

## Verdict

TN6-X PASS as an observational gate.
Evidence coverage improved, but automatic route-candidate association assignment remains blocked.
