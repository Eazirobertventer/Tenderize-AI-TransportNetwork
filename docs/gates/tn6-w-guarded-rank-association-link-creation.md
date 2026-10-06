# TN6-W guarded rank-association link creation

Date: 2026-10-05

PASS.

Five approved taxi_rank_association links were created transactionally.

Created links:
- KRPUTD025 -> Estcourt District Taxi Association
- KRPUMD001 -> Mtubatuba Taxi Owners L&L Distance Ass.
- KRPUTD022 -> Klipriver Taxi Association
- KRPUTD001 -> Bergville Taxi Association
- KRPUZD021 -> Dundee Transport Association

Guards:
- rank locked and resolved uniquely
- target association locked and resolved uniquely
- rank re-checked for existing links inside the transaction
- transaction aborts on any conflicting existing link
- verification_status=documented
- confidence=1.0
- no association identity writes
- no route-candidate writes
- no canonical-route writes

Post-write verification:
- all five intended links exist exactly once
- each target rank has exactly one association link
- verification_status is documented
- confidence is 1.0

Initial Railway startup attempts failed to connect before DATABASE_URL was available. Those attempts failed before the transaction. A later run committed successfully and verified all five links.

Write scope:
rankLinkWrites: 5
associationWrites: 0
routeCandidateWrites: 0
canonicalRouteWrites: 0
