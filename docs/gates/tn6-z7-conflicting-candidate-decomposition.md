# TN6-Z7 conflicting-candidate decomposition

Date: 2026-10-06

## Verdict

PARTIAL PASS — structural decomposition complete; documentary decomposition complete for the verified route-code subset.

## Live conflict population

TN6-Z6:
- total route candidates: 1,045
- conflicting: 21

Current linked KZN ranks all have exactly one rank-association link.
Therefore a conflicting candidate cannot currently be caused by:
- multiple associations on one endpoint
- multiple shared associations
- duplicate association IDs on the same endpoint

The 21 conflicts are structurally:
- distinct-association endpoint pairs: 21
- multi-association endpoint conflicts: 0
- same-association/shared-ID anomalies: 0

## Documentary-confirmed legitimate cross-association routes

The verified route-code seed already proves these cross-association patterns as legitimate route operation rather than data inconsistency:

1. KZNBRCLDY000651
   - Weenen Taxi Rank / Weenen & District Taxi Association
   - to Estcourt Main Taxi Rank / Estcourt District Taxi Association

2. KZNBRCLDY006020
   - Estcourt Main Taxi Rank / Estcourt District Taxi Association
   - to Weenen Taxi Rank / Weenen & District Taxi Association

3. KZNBRCLDY1054
   - Loskop / Amangwe Tribal Court / Amangwe-Bhekuzulu Taxi Association
   - to Bergville Taxi Rank / Bergville Taxi Association

4. KZNBRCLDY1085
   - Loskop / Amangwe Tribal Court / Amangwe-Bhekuzulu Taxi Association
   - to Lyell Street/Ladysmith destination under Klipriver-linked rank evidence

5. KZNBRCLDY1220
   - Loskop / Amangwe Tribal Court / Amangwe-Bhekuzulu Taxi Association
   - to Estcourt Main Taxi Rank / Estcourt District Taxi Association

6. KZNBRCPMB00680
   - Church Street Rank No 1 / PMBURG Long Distance Taxi Association
   - to Ladysmith/Lyell Street / Klipriver-linked rank

7. KZNBRCPMB00681
   - Church Street Rank No 1 / PMBURG Long Distance Taxi Association
   - to Estcourt Main Taxi Rank / Estcourt District Taxi Association

These exact gazette-backed routes should remain conflicting by design. They are not automatic-assignment candidates.

## Remaining conflicts

At least 7 of 21 are documentary-confirmed legitimate cross-association routes.
The remaining 14 are structurally cross-association endpoint pairs but still require exact route-code/document review before being classified as:
- legitimate cross-association operation
- shared-terminal use
- rank identity/link inconsistency

No evidence currently supports treating any of the 21 as a same-association route.

## Safety rule

Do not reduce the conflicting bucket merely to create shared matches.

A conflict is expected when:
- origin rank belongs to Association A
- destination rank belongs to Association B
- Association A operates to Association B's terminal, or vice versa

Route ownership and terminal association membership are separate concepts.

## Writes

databaseWrites: 0
rankAliasWrites: 0
rankLinkWrites: 0
routeCandidateWrites: 0
canonicalRouteWrites: 0
