# TN6-P safe rank-alias promotion plan

Date: 2026-10-05

This gate is dry-run only. No rank names or aliases were changed.

## Proposed aliases
- KRPADM001 -> Newcastle Sizwe Main Taxi Rank
- KRPIDM001 -> Stanger Taxi Rank
- KPC0093 -> Professor Nyembezi (Symons Centre) Taxi Terminal
- KRPUGD003 -> Port Shepstone Main Taxi Rank
- KRPUTD025 -> Estcourt Main Taxi Rank
- KRPUMD001 -> Mtubatuba Taxi Rank
- KRPUTD022 -> Lyell Street Taxi Rank
- KRPUTD001 -> Bergville Taxi Rank
- KRPZDM002 -> Vryheid Main Taxi Rank
- KRPUZD021 -> Dundee Taxi Rank

## Collision check
Exact or normalized canonical-name/alias collisions: 0 of 10.

## Nearby coded-rank checks
- KRPADM001: KRPADM002 is 258.3 m away.
- KPC0093: multiple Pietermaritzburg coded ranks are within 155-688 m.
- KRPUMD001: KRPUMD0023 is 156.9 m away.

These are spatial neighbours, not name collisions. They remain distinct source records and must not be merged automatically.

## Promotion classes
Safe alias-add candidates: all 10, provided the write gate:
1. appends the human-readable name to aliases only;
2. preserves the source code as canonical_name;
3. refuses duplicate normalized aliases across any other rank;
4. performs no rank merges;
5. performs no association or route promotion.

## Verdict
TN6-P PASS — dry-run promotion plan is collision-free.
Writes performed: 0.
