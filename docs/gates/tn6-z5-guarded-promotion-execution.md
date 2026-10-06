# TN6-Z5 guarded promotion execution

Date: 2026-10-06

## Verdict

PASS.

Three strong candidates were promoted transactionally.

## Created associations

- Weenen & District Taxi Association
- Amangwe-Bhekuzulu Taxi Association
- PMBURG Long Distance Taxi Association

All three:
- province: KwaZulu-Natal
- municipality: per TN6-Z4 plan
- registration_number: null
- verification_status: documented
- confidence: 1.0

## Rank aliases appended

- KRPUTD023 -> Weenen Taxi Rank
- KRPUTD068 -> Loskop / Amangwe Tribal Court Taxi Rank
- KPC0031 -> Church Street Rank No 1, Pietermaritzburg

Canonical rank codes were preserved.

## Rank-association links created

- KRPUTD023 -> Weenen & District Taxi Association
- KRPUTD068 -> Amangwe-Bhekuzulu Taxi Association
- KPC0031 -> PMBURG Long Distance Taxi Association

Each target rank has exactly one association link after commit.

## Verification

All three records passed post-write verification:
- alias present
- association exists exactly once
- association province/municipality match the approved plan
- registration_number is null
- association verification_status is documented
- association confidence is 1.0
- rank link verification_status is documented
- rank link confidence is 1.0
- total association links on each rank = 1

Initial Railway startup attempts failed to connect before DATABASE_URL was available. Those attempts failed before the transaction. A later run committed successfully.

## Write scope

associationCreates: 3
aliasWrites: 3
rankLinkWrites: 3
routeCandidateWrites: 0
canonicalRouteWrites: 0
