# TN6-Z9 final five documentary holds: alternate-code resolution

Date: 2026-10-06

## Verdict

PARTIAL PASS.

Two of the five held GIS route codes are resolved one-to-one to an authoritative documentary route.
Three Amangwe/Loskop codes are resolved at route-family/classification level but their one-to-one alternate-code mapping remains unproven.

## 1. KZNBRCUTD0001

Rank context:
- KRPUTD023 / Weenen Taxi Rank
- association: Weenen & District Taxi Association

Documentary route catalogue includes:
- Weenen -> Ladysmith
- alternate operating-licence route id: 2202DU2202DU00052770
- origin: Weenen Taxi Rank
- destination: Alexandra Street Taxi Rank, Ladysmith

Given the already-accounted Weenen routes in the live candidate set:
- Weenen -> Estcourt
- Estcourt -> Weenen
- Lyell Street -> Weenen

the remaining conflict route is consistent with Weenen -> Ladysmith.

Classification:
- legitimate cross-association
- confidence: high
- alternate documentary id: 2202DU2202DU00052770

## 2. KZNBRCUMGD00079

Rank context:
- KPC0031 / Church Street Rank No 1, Pietermaritzburg
- association: PMBURG Long Distance Taxi Association

The live rank has three route codes:
- KZNBRCPMB00680 -> Ladysmith
- KZNBRCPMB00681 -> Estcourt
- KZNBRCUMGD00079 -> remaining held route

Authoritative PMBURG Long Distance route catalogue documents:
- Church Street Rank No 1, Pietermaritzburg -> Bergville
- alternate operating-licence route id: KZPRERC2983328

Classification:
- legitimate cross-association
- confidence: high
- alternate documentary id: KZPRERC2983328

## 3-5. Amangwe / Loskop route-code family

Held GIS codes:
- KZNBRCLDY00023
- KZNBRCUTD00023
- KZNBRCUTD00082

Rank context:
- KRPUTD068 / Loskop / Amangwe Tribal Court Taxi Rank
- association: Amangwe-Bhekuzulu Taxi Association

Authoritative gazettes repeatedly document exactly three principal cross-association routes from Amangwe/Loskop to currently linked destination ranks:
- Loskop -> Estcourt
  alternate documentary id: 2001A12202EN10053929
- Loskop -> Ladysmith
  alternate documentary id: 2001A12202DH10053910
- Loskop -> Bergville
  alternate documentary id: 2001A12202ER10053911

The three held GIS codes are consistent with this same three-route family and all three routes are legitimate cross-association operations.

However, because the KZN GIS endpoint could not be queried from the available execution environment, the exact one-to-one mapping:
- GIS code -> Estcourt
- GIS code -> Ladysmith
- GIS code -> Bergville

cannot be proved in this gate.

Classification for each of the three held GIS codes:
- legitimate cross-association route family
- association context: Amangwe-Bhekuzulu Taxi Association
- one-to-one alternate-code alias: HOLD
- no data inconsistency indicated

## Final Z7-Z9 conflict disposition

Of 21 live conflicts:
- 18 are now documentary-confirmed or route-family-confirmed legitimate cross-association operations
- 3 are legitimate at route-family level but retain one-to-one alias mapping HOLD
- 0 confirmed same-association anomalies
- 0 confirmed rank-link inconsistencies

No conflict currently justifies changing a rank-association link merely to create a shared association match.

## Safety

databaseWrites: 0
rankAliasWrites: 0
rankLinkWrites: 0
routeCandidateWrites: 0
canonicalRouteWrites: 0
