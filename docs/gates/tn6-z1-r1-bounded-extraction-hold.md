# TN6-Z1-R1 bounded KZN gazette extraction

Date: 2026-10-06

## Verdict

HOLD — source retrieval unavailable.

The TN6-Z1 parser/fixture CI is PASS on exact head, but the first live bounded batch could not be executed because the authoritative KZN Transport PDF host timed out before any document bytes were received.

## Bounded batch

Target documents:
- LGKZNG06-2025-MAY
- LGKZNG11-2025-JUN
- LGKZNG13-2025-JUL

## Execution evidence

Attempt 1:
- GitHub Actions Node fetch
- failure: UND_ERR_CONNECT_TIMEOUT to www.kzntransport.gov.za:443
- extraction did not start

Attempt 2:
- GitHub Actions IPv4 curl with retries and 30-second connect timeout
- failure: repeated connection timeout to www.kzntransport.gov.za:443
- extraction did not start

Railway connectivity probe:
- HEAD/range requests to the same authoritative PDF URLs also timed out
- no source bytes were obtained

Search-engine indexing confirms all three documents exist and are text-indexed, but search snippets are not accepted as a substitute for executing the extractor against the source PDFs.

## Extractor readiness

The worker now supports:
- remote PDF fetch
- local PDF input via --pdf=
- JSONL evidence output
- bounded evidence summary metrics

Expected summary metrics once source files are available:
- documents
- evidence rows
- unique applications
- unique associations
- unique operating licences
- unique route identifiers
- rows with rank mentions
- rows with association + rank mentions
- rows with association + route identifiers
- unique normalized rank mentions
- hits against known recovered rank identities

## Safety

databaseWrites: 0
rankLinkWrites: 0
routeCandidateWrites: 0
canonicalRouteWrites: 0

## Resume condition

Resume TN6-Z1-R1 unchanged when either:
1. kzntransport.gov.za PDF access is restored from the execution environment, or
2. an authoritative/mirrored copy of the exact three PDFs is available.

Do not invent coverage counts from search-index snippets.
