# TN6-Q guarded alias promotion

Date: 2026-10-05

## Result
PASS.

All 10 approved human-readable aliases were appended transactionally to the existing coded KZN taxi-rank records.

## Guardrails
- canonical_name preserved as the KZN source code
- normalized alias uniqueness checked inside the transaction
- transaction aborts on any collision
- no rank merge
- no association writes
- no route-candidate writes
- no canonical route writes

## Verified state
- KRPADM001 -> alias Newcastle Sizwe Main Taxi Rank
- KRPIDM001 -> alias Stanger Taxi Rank
- KPC0093 -> alias Professor Nyembezi (Symons Centre) Taxi Terminal
- KRPUGD003 -> alias Port Shepstone Main Taxi Rank
- KRPUTD025 -> alias Estcourt Main Taxi Rank
- KRPUMD001 -> alias Mtubatuba Taxi Rank
- KRPUTD022 -> alias Lyell Street Taxi Rank
- KRPUTD001 -> alias Bergville Taxi Rank
- KRPZDM002 -> alias Vryheid Main Taxi Rank
- KRPUZD021 -> alias Dundee Taxi Rank

All ten post-write verification checks returned true.

## Write scope
alias writes: 10
canonical-name writes: 0
association writes: 0
route-candidate writes: 0
canonical-route writes: 0

Initial connection-refused process starts occurred before the Railway DATABASE_URL reference became available. Those attempts failed before any transaction. A later run completed and verified all ten writes.
