# TN6-Z3 expanded verified route-code evidence seed

Date: 2026-10-06

## Verdict

PASS — verified exact-route evidence seed expanded from 6 to 11 route codes.

## Seed additions

- KZNBRCLDY0951 -> Klipriver Taxi Association
- KZNBRCLDY259 -> Bergville Taxi Association
- KZNBRCPMB00680 -> PMBURG Long Distance Taxi Association
- KZNBRCPMB00681 -> PMBURG Long Distance Taxi Association
- KZNBRCLDY0055 -> Dundee Transport Association

These were added only where exact KZNBRCD, route direction/rank narrative and association context were explicit in authoritative provincial gazettes.

## Live side-aware join

Exact route evidence seeds: 11
Matched route rows: 11
Unresolved ranks covered: 6
Strong origin-side association candidates: 3
Origin-evidence conflicts: 0
Identity-only ranks: 3

### Strong association candidates

1. KRPUTD023
   - identity: Weenen Taxi Rank
   - origin evidence: KZNBRCLDY000651
   - association: Weenen & District Taxi Association
   - reverse route KZNBRCLDY006020 is Estcourt District Taxi Association from known Estcourt origin, confirming directional interpretation.

2. KRPUTD068
   - identity: Loskop / Amangwe Tribal Court Taxi Rank
   - origin evidence routes:
     - KZNBRCLDY1054
     - KZNBRCLDY1085
     - KZNBRCLDY1220
   - association: Amangwe-Bhekuzulu Taxi Association

3. KPC0031
   - identity candidate: Church Street Rank No 1, Pietermaritzburg
   - origin evidence routes:
     - KZNBRCPMB00680
     - KZNBRCPMB00681
   - association: PMBURG Long Distance Taxi Association

### Identity-only ranks

1. KRPADM001 / Newcastle Sizwe Main Taxi Rank
   - KZNBRCLDY0951 arrives from Lyell Street under Klipriver Taxi Association
   - KZNBRCLDY259 arrives from Bergville under Bergville Taxi Association
   - destination-only evidence confirms Newcastle as shared destination, not one association membership.

2. KRPUTD002
   - KZNBRCLDY0857 arrives at Winterton from Lyell Street under Klipriver Taxi Association
   - identity evidence only; do not link Winterton to Klipriver based on destination use.

3. KRPADM022
   - KZNBRCLDY0055 arrives from Dundee under Dundee Transport Association
   - destination-only evidence; association membership not established.

## Coverage

- 151 unresolved counterpart ranks total
- 6 currently covered by verified exact-route anchors
- 3 strong association candidates
- 3 identity-only
- 145 ranks remain without a verified exact-route seed

## Safety

databaseWrites: 0
rankAliasWrites: 0
rankLinkWrites: 0
routeCandidateWrites: 0
canonicalRouteWrites: 0
