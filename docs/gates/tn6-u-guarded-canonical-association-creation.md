# TN6-U guarded canonical association creation

Date: 2026-10-05

PASS.

Five authoritative KZN taxi association identities were created transactionally.

Created:
- Estcourt District Taxi Association
- Mtubatuba Taxi Owners L&L Distance Ass.
- Klipriver Taxi Association
- Bergville Taxi Association
- Dundee Transport Association

Guards:
- exact normalized-name collision check before each insert
- one transaction for all five inserts
- registration_number left null
- verification_status=documented
- confidence=1.0
- no rank-association links
- no route-candidate writes
- no canonical-route writes

Post-write verification:
- all five records present exactly once
- province/municipality match the approved TN6-T plan
- registration_number is null
- verification_status is documented
- confidence is 1.0

Initial Railway startup attempts failed to connect before the DATABASE_URL reference was available. Those attempts failed before the transaction. A later run committed successfully and verified all five records.

Write scope:
association writes: 5
rank-link writes: 0
route-candidate writes: 0
canonical-route writes: 0
