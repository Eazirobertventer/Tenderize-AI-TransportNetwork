# TN6-M — Live KZN route-candidate association evidence

Executed against the live Railway PostGIS dataset on 2026-10-05.

## Safety boundary

- Read-only query only.
- No writes to `taxi_association`.
- No writes to `taxi_rank_association`.
- No writes to `route_candidate.association_id`.
- No writes or promotion into canonical `taxi_route`.

## Live result

| Bucket | Count |
|---|---:|
| shared | 0 |
| origin-only | 0 |
| destination-only | 23 |
| conflicting | 0 |
| none | 1,022 |
| **Total** | **1,045** |

Eligible for automatic assignment under the TN6-L rule (exactly one shared association across both endpoint ranks): **0**.

## Gate verdict

TN6-M PASS as an observational gate.

No candidate qualifies for automatic association assignment. A later gate must improve endpoint association coverage/evidence before any automatic assignment is considered.
