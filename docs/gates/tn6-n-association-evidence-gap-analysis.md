# TN6-N — Association-evidence gap analysis

Executed against the live Railway PostGIS dataset on 2026-10-05.

## Safety boundary

- Read-only analysis.
- No writes to `taxi_association`.
- No writes to `taxi_rank_association`.
- No writes to `route_candidate.association_id`.
- No canonical `taxi_route` promotion.

## Population

- KZN exact route candidates: **1,045**
- Distinct endpoint ranks: **514**
- Endpoint ranks without a current canonical association link: **512**

## Gap classes

| Class | Ranks | Candidate endpoint touches |
|---|---:|---:|
| Already linked | 2 | 23 |
| Recoverable authoritative evidence | 2 | 24 |
| Reconciliation needed | 0 | 0 |
| No current evidence | 510 | 2,043 |

Candidate endpoint touches count origin + destination appearances, so the total is 2,090 for 1,045 route candidates.

## Recoverable authoritative ranks

1. **Pine St North Taxi Rank**
   - Candidate touches: 14
   - Origin: 1
   - Destination: 13
   - Official evidence: `Umlazi West Transport Services`
   - Source: `ethekwini-bus-taxi-ranks-degraded`
   - Current canonical association link: none

2. **Universary Ave Taxi Rank**
   - Candidate touches: 10
   - Origin: 1
   - Destination: 9
   - Official evidence: `Ningizimu One Region`
   - Source: `ethekwini-bus-taxi-ranks-degraded`
   - Current canonical association link: none

These are evidence-recovery candidates only. TN6-N does not assign them.

## Already-linked ranks

1. **Tomato Hall/ Mahlathi Rd Taxi Rank**
   - Candidate touches: 12
   - Current association: `Chesterville Westville Taxi Association`

2. **Cartwrights Flats Taxi Rank**
   - Candidate touches: 11
   - Current association: `Durban - Long Taxi Association`

## Highest-impact ranks with no current evidence

| Rank | Candidate touches |
|---|---:|
| KRPADM001 | 59 |
| KRPIDM001 | 59 |
| KPC0093 | 55 |
| KRPUGD003 | 55 |
| KRPUTD025 | 55 |
| KRPUMD001 | 48 |
| KRPUTD022 | 48 |
| KRPUTD001 | 41 |
| KRPZDM002 | 37 |
| KRPUZD021 | 35 |
| KRPUZD042 | 32 |
| KPC0023 | 30 |
| KRPUHD009 | 28 |
| KRPUTD027 | 28 |
| KRPUHD002 | 27 |

## Interpretation

The blocker is not conflicting association evidence. It is missing association evidence.

Only 2 unresolved ranks have a single authoritative source label that can be recovered through a later controlled gate. No unresolved endpoint ranks currently fall into the reconciliation-needed class.

The most valuable next step is to recover source identity/evidence for the highest-impact coded KZN ranks, starting with KRPADM001 and KRPIDM001 (59 candidate touches each), rather than implementing assignment logic.

## Verdict

**TN6-N PASS — observational gap analysis complete.**
