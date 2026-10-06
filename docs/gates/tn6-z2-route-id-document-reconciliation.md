# TN6-Z2 route-ID/document reconciliation

Date: 2026-10-06

## Verdict

PARTIAL PASS — exact route-code bridging is proven and yields high-quality candidates, but current verified gazette anchors cover only a small subset of the 151 unresolved counterpart ranks.

## Population

- unresolved counterpart ranks: 151
- one-sided route-candidate touches: 234
- ranks with GIS route codes: 151 of 151

Every unresolved counterpart rank has one or more KZN GIS KZNBRCD values, so route-code/document reconciliation is technically applicable to the full population.

## Exact route-code bridge proof

KZN GIS KZNBRCD values recur verbatim in authoritative KwaZulu-Natal Provincial Gazette operating-route records.

Examples:
- KZNBRCLDY0002207 = Newcastle -> Ladysmith
- KZNBRCLDY0857 = Ladysmith/Lyell Street -> Winterton
- KZNBRCLDY000651 = Weenen -> Estcourt
- KZNBRCLDY006020 = Estcourt -> Weenen
- KZNBRCLDY1054 = Loskop/Amangwe -> Bergville
- KZNBRCLDY1085 = Loskop/Amangwe -> Ladysmith
- KZNBRCLDY1220 = Amangwe -> Estcourt

This proves route-code equality is a valid documentary bridge when an indexed gazette hit exists.

## First verified evidence seed

Verified route-association anchors loaded: 6.

The live join across all 151 ranks produced:
- ranks with any exact verified route anchor: 3
- raw unique-association candidates before direction check: 2
- raw conflicting candidates before direction check: 1
- ranks with no verified route anchor yet: 148

## Side-aware reconciliation

### KRPUTD068

Matched exact routes:
- KZNBRCLDY1054 -> Amangwe-Bhekuzulu Taxi Association -> Bergville
- KZNBRCLDY1085 -> Amangwe-Bhekuzulu Taxi Association -> Ladysmith
- KZNBRCLDY1220 -> Amangwe-Bhekuzulu Taxi Association -> Estcourt

In all three rows:
- KRPUTD068 is the unresolved ORIGIN
- the known destination ranks are linked to different destination associations
- the route association is consistently Amangwe-Bhekuzulu Taxi Association

Document narratives identify the origin as Loskop Taxi Rank / Amangwe Tribal Court Taxi Rank.

Candidate:
- rank identity: Loskop / Amangwe Tribal Court Taxi Rank
- association evidence: Amangwe-Bhekuzulu Taxi Association
- confidence class: strong documentary candidate
- writes: none

### KRPUTD023

KZNBRCLDY000651:
- route: Weenen -> Estcourt
- unresolved side: ORIGIN KRPUTD023
- known destination: KRPUTD025 / Estcourt Main Taxi Rank
- route association: Weenen & District Taxi Association

KZNBRCLDY006020:
- route: Estcourt -> Weenen
- unresolved side: DESTINATION KRPUTD023
- known origin: KRPUTD025 / Estcourt Main Taxi Rank
- route association: Estcourt District Taxi Association
- route association matches the known origin association

Directional interpretation removes the apparent conflict.

Candidate:
- rank identity: Weenen Taxi Rank
- association evidence: Weenen & District Taxi Association from the route where KRPUTD023 is origin
- confidence class: strong documentary candidate
- writes: none

### KRPUTD002

Matched exact route:
- KZNBRCLDY0857 = Ladysmith/Lyell Street -> Winterton
- unresolved side: DESTINATION KRPUTD002
- known origin: KRPUTD022 / Lyell Street Taxi Rank
- route association: Klipriver Taxi Association
- route association matches the known origin association

Candidate:
- rank identity: Winterton Taxi Rank
- association evidence for Winterton itself: NOT ESTABLISHED
- do not link Winterton to Klipriver based only on destination usage

## Safety rule established by TN6-Z2

A route association must not be copied to both endpoint ranks.

For rank-association recovery:
- strongest evidence is when the unresolved rank is the documented origin/departure rank of the association's licensed route;
- a destination-only occurrence can establish rank identity, but not association membership;
- reverse-direction routes can be used to distinguish route ownership from shared destination usage;
- conflicting route associations must be interpreted directionally before classifying the rank as ambiguous.

## Coverage

Verified route-code seeds currently touch 3 of 151 unresolved ranks.
148 ranks remain without a verified gazette route anchor in the seed set.

This is a seed-coverage limitation, not a failure of the route-code bridge. Additional indexed gazette route IDs can expand coverage incrementally.

## Writes

databaseWrites: 0
rankAliasWrites: 0
rankLinkWrites: 0
routeCandidateWrites: 0
canonicalRouteWrites: 0
