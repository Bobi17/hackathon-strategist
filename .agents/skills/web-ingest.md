---
name: web-ingest
description: Fetch and normalize hackathon website content — boilerplate stripping, nested/paginated pages, capturing agenda/tracks/past-winners sections — with a local cache. Use before any event research.
---

# Web Ingest — event website normalization

Procedure for the ingestion stage. Turns raw web content into clean, queryable
input for the research personas.

## Steps
1. **Fetch** each `websiteUrls` entry via `fetchWithEscalation` (see
   `src/research/fetch.ts`). The escalation chain:
   - **Plain fetch** (fast path): if the normalized content is ≥ 300 chars
     (configurable via `config.minContentChars`), accept it.
   - **Browser render** (Playwright Chromium): if a browser session is
     available and the plain-fetched content is thin, render the page with
     JavaScript executed and extract the visible text. A persistent Chromium
     profile at `output/<slug>/.cache/browser-profile/` stores cookies so a
     login persists across URLs and re-runs.
   - **Interactive auth gate** (UI mode only): open a visible Chromium window
     at the gated URL. The human signs in, then clicks **I've signed in —
     continue** in the control room — or pastes the rendered page text. In
     headless mode with no saved session: record a gap.
   - When `config.useBrowser: true`, the plain-fetch fast path is skipped and
     the browser engine is used for every URL (useful for known SPA / login-
     gated events).
2. **Normalize:** strip navigation/boilerplate; keep text, tables, and link
   targets. Preserve the URL for every kept section (citations).
3. **Capture the sections research needs:** agenda/schedule, tracks, rules &
   submission requirements, prizes, sponsors, judges, and past winners (links).
4. **Follow key links** (nested/paginated) up to a configured depth (default 2)
   for past-winners pages, sponsor pages, and the rules page.
5. **Cache** the normalized result (`output/<slug>/.cache/`) so a re-run skips
   re-fetching and re-logging-in. Any source (fetch, browser, or pasted)
   produces a cached entry keyed by URL — subsequent runs reuse it immediately.

## Degradation
- Missing sections (e.g., no past-winners page) are recorded as gaps, not
  errors — downstream personas continue on labeled assumptions.
- Login-gated pages in headless mode without a saved session become gaps;
  set `useBrowser: true` or switch to interactive mode (`--ui`) to handle
  them.

## Output
Structured `IngestedInput`: normalized site sections (with URLs), raw problem
statements (verbatim), dataset inventory, rubric & gating text when found.
