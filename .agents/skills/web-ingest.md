---
name: web-ingest
description: Fetch and normalize hackathon website content — boilerplate stripping, nested/paginated pages, capturing agenda/tracks/past-winners sections — with a local cache. Use before any event research.
---

# Web Ingest — event website normalization

Procedure for the ingestion stage. Turns raw web content into clean, queryable
input for the research personas.

## Steps
1. **Fetch** each `websiteUrls` entry. On failure, retry once, then fall back to
   pasted content or flag `missing website` with `low`-confidence assumptions.
2. **Normalize:** strip navigation/boilerplate; keep text, tables, and link
   targets. Preserve the URL for every kept section (citations).
3. **Capture the sections research needs:** agenda/schedule, tracks, rules &
   submission requirements, prizes, sponsors, judges, and past winners (links).
4. **Follow key links** (nested/paginated) up to a configured depth (default 2)
   for past-winners pages, sponsor pages, and the rules page.
5. **Cache** the normalized result (`output/<slug>/.cache/`) so a re-run skips
   re-fetching. The cache is part of the run, not an artifact.

## Degradation
- JS-rendered site that resists parsing → mark for a Playwright fallback
  (Phase-5 hardening), and proceed on the HTML you did get.
- Missing sections (e.g., no past-winners page) are recorded as gaps, not
  errors — downstream personas continue on labeled assumptions.

## Output
Structured `IngestedInput`: normalized site sections (with URLs), raw problem
statements (verbatim), dataset inventory, rubric & gating text when found.
