# TN6-Z1-R2 authoritative mirror recovery

Date: 2026-10-06

## Verdict

PARTIAL PASS.

Exact document mirrors for the three target KZN Transport PDFs were not recovered.

Authoritative route-level mirrors were recovered in KwaZulu-Natal Provincial Gazette PDFs hosted by SAFLII for all three target anchor routes.

## Target 1: LGKZNG06-2025-MAY

Target anchor:
- route ID: 2207GY2207GY00050412
- association: NQUTHU DISTRICT PIONEERS TAXI ASSOC.

Authoritative mirror:
- Provincial Gazette No. 2798, 3 April 2025
- embedded transport gazette: LGKZNG48-2025-MAR
- SAFLII: https://www1.saflii.org/za/gaz/ZAKZPrGaz/2025/31.pdf

Mirror evidence reproduces route ID 2207GY2207GY00050412 and the NQUTHU DISTRICT PIONEERS TAXI ASSOC. association context.

Identity class:
- exact document mirror: NO
- authoritative route-level mirror: YES

## Target 2: LGKZNG11-2025-JUN

Target anchor:
- route ID: 2203BJ2202ER00047603
- association: BERGVILLE TAXI ASSOCIATION

Authoritative mirrors:
- Provincial Gazette No. 2780, 13 February 2025 / embedded LGKZNG41-2025-JAN
- Provincial Gazette No. 2727, 15 August 2024 / embedded LGKZNG16-2024-JUL

Both provincial gazettes reproduce route ID 2203BJ2202ER00047603 with BERGVILLE TAXI ASSOCIATION and the same Moyeni-to-Bergville route narrative.

Identity class:
- exact document mirror: NO
- authoritative route-level mirror: YES

## Target 3: LGKZNG13-2025-JUL

Target anchor:
- route ID: KZPRERC2775617
- association: NOT AVAILABLE
- applicant identity in target: T NONGINZI

Authoritative mirrors:
- Provincial Gazette No. 2798, 3 April 2025 / embedded LGKZNG48-2025-MAR
- Provincial Gazette No. 2780, 13 February 2025 / embedded LGKZNG41-2025-JAN
- Provincial Gazette No. 2716, 18 July 2024 / embedded LGKZNG12-2024-JUN

These mirrors reproduce route ID KZPRERC2775617 and the same 45 Hope Street, Kokstad metered-taxi narrative. One mirror also contains applicant T NONGINZI.

Identity class:
- exact document mirror: NO
- authoritative route-level mirror: YES

## Execution constraint

The GitHub mirror-verification workflow attempted to download the SAFLII PDFs and received HTTP 403 from the mirror host.
Therefore the repository extractor was not executed against the mirror PDF bytes in this gate.

The web-indexed SAFLII PDF text was used only to verify route-level identity anchors. No coverage counts were fabricated.

## Implication

For TN6-Z2, route identifiers can be used as strong documentary bridge keys when the same route ID and narrative recur across authoritative provincial-gazette copies.

Do not treat route-level mirror equivalence as proof that two gazette documents are byte-identical or the same publication issue.

## Safety

databaseWrites: 0
rankLinkWrites: 0
routeCandidateWrites: 0
canonicalRouteWrites: 0
