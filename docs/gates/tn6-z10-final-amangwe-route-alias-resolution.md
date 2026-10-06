# TN6-Z10 final Amangwe GIS-code alias resolution

Date: 2026-10-06

## Verdict

PASS — the final three Amangwe GIS-code holds have exact endpoint resolution from the live KZN route-candidate dataset.

## Live KZN GIS endpoint mapping

### KZNBRCLDY00023
- origin: KRPUTD068 / Loskop / Amangwe Tribal Court Taxi Rank
- destination: KRPUTD001 / Bergville Taxi Rank
- endpoint reconciliation: exact_endpoint_pair
- origin distance: 0m
- destination distance: 0m
- source: KZN Department of Transport Taxi Routes
- municipality: Inkosi Langalibalele
- district: Uthukela

Documentary equivalent:
- KZNBRCLDY1054
- OLAS route id: 2001A12202ER10053911
- Loskop / Amangwe Tribal Court -> Bergville

Classification:
- legitimate cross-association
- GIS route-code alias/version variant of documented Loskop -> Bergville route family

### KZNBRCUTD00023
- origin: KRPUTD068 / Loskop / Amangwe Tribal Court Taxi Rank
- destination: KRPUTD025 / Estcourt Main Taxi Rank
- endpoint reconciliation: exact_endpoint_pair
- origin distance: 0m
- destination distance: 0m
- source: KZN Department of Transport Taxi Routes
- municipality: Inkosi Langalibalele
- district: Uthukela

Documentary equivalent:
- KZNBRCLDY1220
- OLAS route id: 2001A12202EN10053929
- Loskop / Amangwe Tribal Court -> Estcourt

Classification:
- legitimate cross-association
- GIS route-code alias/version variant of documented Loskop -> Estcourt route family

### KZNBRCUTD00082
- origin: KRPUTD025 / Estcourt Main Taxi Rank
- destination: KRPUTD068 / Loskop / Amangwe Tribal Court Taxi Rank
- endpoint reconciliation: exact_endpoint_pair
- origin distance: 0m
- destination distance: 0m
- source: KZN Department of Transport Taxi Routes
- municipality: Inkosi Langalibalele
- district: Uthukela

Documentary context:
- the licensed Loskop/Estcourt route narratives explicitly describe return travel from Estcourt Taxi Rank to Amangwe Taxi Rank along the same corridor
- this GIS row is the reverse-direction representation of the documented Estcourt/Amangwe corridor

Classification:
- legitimate cross-association reverse-direction route
- no rank-link inconsistency

## Correction to TN6-Z9

TN6-Z9 described the three remaining GIS codes as an unresolved one-to-one set across Estcourt, Ladysmith and Bergville.

Live GIS endpoint recovery shows the correct mapping is:
- one Amangwe -> Bergville row
- one Amangwe -> Estcourt row
- one Estcourt -> Amangwe reverse row

There is no remaining Ladysmith alias hold in this three-code set.

## Final conflict disposition

All 21 TN6-Z6 conflicts are now explained as legitimate cross-association/cross-terminal route topology.

- legitimate cross-association or documented reverse-direction: 21
- unresolved documentary holds: 0
- confirmed same-association anomalies: 0
- confirmed rank-link inconsistencies: 0

These conflicts must not be converted into shared-association matches.

## Safety

databaseWrites: 0
rankAliasWrites: 0
rankLinkWrites: 0
routeCandidateWrites: 0
canonicalRouteWrites: 0
