# TN6-T guarded canonical association creation plan

Date: 2026-10-05

Dry-run only. No association or rank-link writes.

## Planned association creates

1. Estcourt District Taxi Association
   - province: KwaZulu-Natal
   - municipality: Inkosi Langalibalele Local Municipality
   - intended rank: KRPUTD025 / Estcourt Main Taxi Rank

2. Mtubatuba Taxi Owners L&L Distance Ass.
   - province: KwaZulu-Natal
   - municipality: Mtubatuba Local Municipality
   - intended rank: KRPUMD001 / Mtubatuba Taxi Rank

3. Klipriver Taxi Association
   - province: KwaZulu-Natal
   - municipality: Alfred Duma Local Municipality
   - intended rank: KRPUTD022 / Lyell Street Taxi Rank

4. Bergville Taxi Association
   - province: KwaZulu-Natal
   - municipality: Okhahlamba Local Municipality
   - intended rank: KRPUTD001 / Bergville Taxi Rank

5. Dundee Transport Association
   - province: KwaZulu-Natal
   - municipality: Endumeni Local Municipality
   - intended rank: KRPUZD021 / Dundee Taxi Rank

## Live collision check

Current taxi_association catalogue: 27 rows.
Exact normalized collisions: 0 of 5.
Credible municipality-aware fuzzy collisions: 0 of 5.

Generic 0.5 token-overlap matches for Klipriver and Bergville are unrelated associations such as Dassenhoek, KwaNdengezi, Lehlabile, Seven and Siqalokuhle; they are not identity conflicts.

## Guarded creation contract

A later write gate must:
- begin one transaction;
- lock/check the current association catalogue;
- normalize canonical_name and fail if any exact normalized match exists;
- optionally re-run municipality/province-aware fuzzy review and fail on any credible collision;
- insert only the five approved rows;
- set province and municipality exactly as above;
- keep registration_number null;
- mark verification_status=documented;
- set confidence=1.0 only if the schema/contract continues to treat authoritative documentary identity as documented;
- write provenance separately; do not misuse operator licence numbers as association registration numbers;
- perform no taxi_rank_association links in the same gate;
- perform no route-candidate or canonical-route writes.

## Verdict

TN6-T PASS.
Planned creates: 5.
Existing records to reuse: 0.
Writes performed: 0.
