# TN6-Z KZN bulk association-source discovery

Date: 2026-10-06

Mode: discovery/read-only. No database writes.

## Objective

Find a systematic authoritative source capable of resolving association evidence across the 151 unresolved counterpart ranks identified in TN6-Y.

## Sources assessed

### 1. KZN Department of Transport GIS
Authoritative public GIS provides:
- Taxi_Ranks: RANK_CODE + geometry + municipality/district metadata
- Taxi_Routes: KZNBRCD + route geometry + municipality/district metadata

Strength:
- authoritative coded spatial source

Limitation:
- no public association identity field on the rank layer
- no validated public direct rank-code -> association crosswalk

### 2. KZN Public Transport Operating Licence Gazette corpus
Current KZN Transport gazette PDFs consistently expose machine-readable fields:
- Application Number
- Gazette Number
- Applicant
- Association
- Operating Licence Number
- Region
- route identifier
- textual route description including rank/terminal/street names

Examples verified in 2025 documents:
- BERGVILLE TAXI ASSOCIATION paired with Bergville Taxi Rank
- ESTCOURT DISTRICT TAXI ASSOCIATION paired with Estcourt Taxi Rank
- route descriptions carry stable numeric route identifiers and detailed rank/street narratives

Strength:
- authoritative association + route/rank textual evidence
- highly regular document structure suitable for automated extraction

Limitation:
- no proven direct equality between gazette route identifiers and GIS KZNBRCD
- joining to GIS rank codes therefore requires name/spatial evidence rather than code equality unless a later proof establishes an identifier crosswalk

### 3. NLTIS / OLAS
Architecturally the strongest prospective identity source for:
- association identity
- registration information
- operating-route relationships
- route descriptions

Limitation:
- no public bulk dataset/API or rank-code crosswalk was discovered in this gate
- do not scrape or infer inaccessible OLAS data

## Bulk-recovery conclusion

No authoritative public single-source table was found that directly maps the 151 KZN coded ranks to taxi associations.

A scalable recovery pipeline is nevertheless feasible using a two-source evidence join:

1. KZN GIS rank point/code
2. KZN GIS route geometry/code
3. KZN operating-licence gazette parser
4. normalize named rank/terminal references from route narratives
5. geocode/crosswalk only against authoritative or already-recovered rank identities
6. require municipality/district compatibility
7. attach association evidence only when the rank identity is unique
8. keep shared-rank / multi-association results as many-to-many evidence
9. never use spatial proximity alone as proof
10. never promote directly to route_candidate.association_id

## Recommended next implementation gate

TN6-Z1: build a dormant/read-only KZN operating-licence corpus extractor.

The extractor should emit evidence rows with:
- gazette document identifier/date
- application number
- association label
- operating licence number
- region
- route identifier
- raw route description
- normalized origin/destination/rank mentions
- source URL
- source authority
- extraction confidence

The extractor must not write taxi_rank_association or route_candidate.

TN6-Z2 can then perform spatial/document reconciliation against the 151 unresolved counterpart ranks.

## Verdict

TN6-Z PASS as a source-discovery gate.

Direct public rank-code -> association crosswalk: NOT FOUND.
Scalable authoritative recovery path: FOUND via KZN GIS + operating-licence gazette corpus.
Database writes: 0.
