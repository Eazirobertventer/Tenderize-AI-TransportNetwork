# TN6-Z4 guarded promotion plan for three strong candidates

Date: 2026-10-06

## Verdict

PASS — dry-run promotion plan only.

## Candidates

1. KRPUTD023
   - proposed alias: Weenen Taxi Rank
   - proposed association: Weenen & District Taxi Association
   - province: KwaZulu-Natal
   - municipality: Inkosi Langalibalele Local Municipality

2. KRPUTD068
   - proposed alias: Loskop / Amangwe Tribal Court Taxi Rank
   - proposed association: Amangwe-Bhekuzulu Taxi Association
   - province: KwaZulu-Natal
   - municipality: Inkosi Langalibalele Local Municipality

3. KPC0031
   - proposed alias: Church Street Rank No 1, Pietermaritzburg
   - proposed association: PMBURG Long Distance Taxi Association
   - province: KwaZulu-Natal
   - municipality: Msunduzi Local Municipality

## Live dry-run checks

For all three ranks:
- target coded rank exists
- current aliases: none
- exact normalized alias collisions: 0
- existing rank-association links: 0

Association catalogue:
- exact canonical match for Weenen & District Taxi Association: 0
- exact canonical match for Amangwe-Bhekuzulu Taxi Association: 0
- exact canonical match for PMBURG Long Distance Taxi Association: 0

Therefore all three associations require guarded canonical creation before linking.

## Required write sequence

A later write gate must execute in this order:

1. Begin one transaction.
2. Re-lock and uniquely resolve each target taxi_rank.
3. Re-check normalized alias collision against every other rank.
4. Re-check target association canonical-name uniqueness.
5. Create only the three approved taxi_association rows if still absent.
6. Keep registration_number null unless independently proven.
7. Append only the approved aliases to each coded rank; preserve canonical_name as the KZN code.
8. Re-check each target rank still has zero association links.
9. Create exactly one approved taxi_rank_association link per rank.
10. Abort the whole transaction on any collision, duplicate association identity, or pre-existing rank link.
11. Verify all created records and links after commit.

Out of scope:
- route_candidate.association_id
- canonical taxi_route promotion
- rank merge
- route assignment
- destination-only association inference

## Evidence basis

KRPUTD023:
- origin-side KZNBRCLDY000651 under Weenen & District Taxi Association
- reverse Estcourt -> Weenen route separates destination use from origin ownership

KRPUTD068:
- three independent origin-side route codes under Amangwe-Bhekuzulu Taxi Association:
  KZNBRCLDY1054, KZNBRCLDY1085, KZNBRCLDY1220

KPC0031:
- two independent origin-side route codes under PMBURG Long Distance Taxi Association:
  KZNBRCPMB00680, KZNBRCPMB00681

## Writes in TN6-Z4

associationWrites: 0
aliasWrites: 0
rankLinkWrites: 0
routeCandidateWrites: 0
canonicalRouteWrites: 0
