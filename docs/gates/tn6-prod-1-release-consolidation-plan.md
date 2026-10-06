# TN6-PROD-1 repository / PR consolidation and release-head plan

Date: 2026-10-06

## Verdict

PASS — release topology is understood. No merge or production deployment performed.

## Current repository topology

main:
- 4345f6b5b92c3741ae556d8f30ee97f72cebf6b7

PR #1 — gate/tn0-tn1-foundation
- head: 480cfbb4297949b99de302c0ffe1b38d30526c53
- base: main
- draft
- 214 commits / 116 changed files

PR #2 — gate/tn6-l-association-evidence
- head: 685e7ac0a677cf6b411efae908486038c92d55ad
- base: main
- draft
- 219 commits / 127 changed files

PR #3 — gate/tn6-ui1-live-rank-evidence
- head: ae257a4d62e7d394e08b71be69f90fa1f0dad409
- base branch: gate/tn6-l-association-evidence
- draft
- 9 commits / 4 changed files relative to its base

PR #4 — gate/tn6-z1-kzn-gazette-extractor
- head: a934209ac2563d0fd0d66569672b14c77100b81f
- base branch: gate/tn6-l-association-evidence
- draft
- 29 commits / 24 changed files relative to TN6-L

## Exact ancestry findings

PR #1 and PR #2 have diverged:
- PR #2 is 16 commits ahead of PR #1
- PR #2 is 11 commits behind PR #1

PR #3 and current PR #2 also diverged:
- PR #3 is 9 commits ahead of the earlier TN6-L point
- PR #3 is 1 commit behind current PR #2

PR #4 is strictly ahead of current PR #2:
- +29 commits
- 0 commits behind

PR #3 and PR #4 are sibling branches:
- PR #4 is 30 commits ahead of PR #3 comparison base
- PR #4 is 9 commits behind PR #3
- therefore neither contains the other

## Recommended release spine

Use PR #4 head as the starting release spine:

a934209ac2563d0fd0d66569672b14c77100b81f

Reason:
- contains current TN6-L lineage
- contains all TN6-Z1 through TN6-Z10 documentary/evidence work
- contains no UI/API divergence from PR #3 that cannot be semantically ported
- is the most complete evidence branch

Create a dedicated release branch in the next gate:
- gate/tn6-prod-release

Do NOT merge the four current draft PRs independently into main.

## Required semantic carry from PR #3

Port the final PR #3 state at:
ae257a4d62e7d394e08b71be69f90fa1f0dad409

Files:
1. .github/workflows/tn6-ui1-live-rank-evidence.yml
2. apps/transport-api/src/server.mjs
3. live/app.js
4. live/styles.css

Important:
- apps/transport-api/src/server.mjs must use the PR #3 final state because it contains the TN6-Z6 PostgreSQL placeholder repair.
- live/app.js must retain alias-first rank labels, source-code visibility, association/provenance display, and canonical/candidate separation.

## PR #1-only divergence requiring review

Compared with PR #2, PR #1 contains eight changed/additive files not present in PR #2's current head:

Additive / likely safe to carry:
1. .github/workflows/tn6-l-kzn-association-inventory.yml
2. apps/kzn-rank-worker/association-field-inventory.mjs
3. apps/kzn-route-worker/association-evidence-readonly.mjs
4. apps/kzn-route-worker/enrich-association-evidence.mjs

Package manifests requiring semantic merge:
5. apps/kzn-rank-worker/package.json
6. apps/kzn-route-worker/package.json

Overlapping runtime/UI files requiring manual reconciliation:
7. apps/transport-api/src/server.mjs
8. live/app.js

Do not blindly merge PR #1 after PR #3.
The runtime/UI versions from PR #3 are newer and must be treated as authoritative unless an identified PR #1 feature is missing.

## Release-head construction order

1. Branch gate/tn6-prod-release from PR #4 head a934209...
2. Apply PR #3 final versions of the four UI/API files.
3. Review PR #1-only additive workers/workflows.
4. Carry only still-required PR #1 worker/inventory functionality.
5. Reconcile package.json scripts/dependencies semantically.
6. Do not overwrite PR #3 server.mjs or live/app.js with PR #1 versions.
7. Run the full repository validation suite.
8. Fix all failing release checks before any merge.
9. Open one consolidated production-release PR to main.
10. Only after that PR is green and reviewed should Railway be pinned to its immutable head SHA.

## Current known release blockers after consolidation

- prove-satellite-map-mode is failing on all major PR heads
- PR #4 extract-first-batch fails because upstream KZN PDF retrieval is unavailable
- PR #4 verify-mirrors fails because mirror download is blocked
- current PRs are all draft and mergeable_state=unstable
- live frontend and API are deployed from different commits on PR #3
- temporary Railway probes/workers remain in production environment

## Safety

mainWrites: 0
pullRequestMerges: 0
productionDeployments: 0
databaseWrites: 0
