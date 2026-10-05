# TN6-V guarded rank-association link plan

Date: 2026-10-05

Dry-run only. No rank-association links were written.

## Intended links

- KRPUTD025 -> Estcourt District Taxi Association
- KRPUMD001 -> Mtubatuba Taxi Owners L&L Distance Ass.
- KRPUTD022 -> Klipriver Taxi Association
- KRPUTD001 -> Bergville Taxi Association
- KRPUZD021 -> Dundee Transport Association

## Live verification

For all five pairs:
- rank identity matched exactly once
- association identity matched exactly once
- existing exact link: none
- conflicting links on the same rank: none
- action: safe_to_link

Summary:
- safe_to_link: 5
- already_linked: 0
- holds: 0
- rankLinkWrites: 0
- associationWrites: 0
- routeCandidateWrites: 0
- canonicalRouteWrites: 0

## Required write-gate contract

A later write gate must:
1. run in one transaction;
2. lock each rank and target association before insert;
3. re-check there are no existing links on the rank;
4. abort the whole transaction if any conflicting link appears;
5. insert only the five approved taxi_rank_association rows;
6. use verification_status=documented;
7. use confidence=1.0 only while the documentary-evidence contract remains unchanged;
8. perform no route-candidate or canonical-route writes.

## Verdict

TN6-V PASS.
All five intended links are currently safe to create.
