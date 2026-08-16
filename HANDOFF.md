handoff-count: 7
blockers: none
---

# Hackathon Strategist — Handoff Ledger

Read this first on any session; update it before ending. This is the
coordination layer for parallel agents.

## Active Phase Matrix

| Phase | Owner | Status | Notes |
|---|---|---|---|
| 0 — Scaffold & config | — | ✅ done | package.json, tsconfigs, config types/schema, example event, CLI |
| 1 — Core domain & bus | — | ✅ done | `src/data/types.ts`, event bus, scoring engine, artifact writer (8 md files) |
| 2 — LLM runner + ingest | — | ✅ done | multi-provider LLM client, persona runner + tools, ingest + parsers |
| 3 — Deliberation loop + orchestrator | — | ✅ done | loop logic, stage machine, budget governor, LLM personas wired, headless CLI end-to-end with real LLM output |
| 4 — Control room | — | ✅ done | WS+HTTP server, React transcript/scoring/verdicts, interject→directive broker, gate holds; smoke-tested live |
| 5 — Harden & ship | — | ✅ done | Browser + Paste Ingestion pipeline, Docker containerization, filesystem/network egress security, 70 tests green |

## Current State

**The core system works end-to-end with real LLM calls at every stage.** Verified
against OmniRoute (`OMNIROUTE_API_KEY` → `http://localhost:2016/v1`, model `auto`,
resolves to `big-pickle`). **Phase 4 (control room) and Phase 5 (Harden & Ship) are fully shipped, containerized, and secure.**

### What works now
- **Config validation** — `EventConfig` schema + defaults + per-event JSONs.
- **Ingestion** — fetches event URLs (with cache), parses local data files, flags gaps.
- **Browser & Paste Ingestion** — Playwright Chromium lazy-loader handles login-walled or JS-heavy SPAs automatically with persistent session profiles under `.cache/browser-profile/`. UI fallback allows users to paste page content directly into the control room if automation fails.
- **Docker Containerization** — Lightweight `node:22-bookworm-slim` sandbox running the Strategist as a non-root `strategist` user. Playwright browser dependencies are fully baked into the image.
- **Security Governance** — Active container restrictions, workspace directory locks, and outbound traffic limits.
- **Research (4 personas, parallel)** — event-intel, sponsor-stakeholder, past-winners, data-analyst; produces findings with citations. Emits a `message` event per persona onto the bus.
- **Synthesize** — decision-lead merges findings into a coherent brief.
- **Ideate** — innovation-scout produces 5-8 candidate idea cards.
- **Deliberation loop** — iterates debate→score→review until unanimous approval or budget exhausted → escalation.
- **Reviewer panel** — Judge, Sponsor, Audience, Build-Feasibility each return per-idea `Approve/Revise` verdicts.
- **Weighted scoring** — 25/20/20/15/10/10 model with sensitivity analysis + non-convergence detection.
- **Artifact writer** — writes all 8 markdown files.
- **Graceful degradation** — personas fail individually without crashing; deterministic stubs with `⚠ degraded` flag.
- **Empty-output retry** — gateway returning an empty body is retried once before degrading (was an intermittent gap).
- **Control room (`--ui`)** — HTTP serves the built React UI; WS `/ws` replays the full event bus then streams live. Browser can:
  - watch the transcript (stages, findings, debate, scores, verdicts, directives, gates) live,
  - **interject** → a directive targeted at a reviewer persona (or all), injected into that persona's next review round and recorded in `directivesApplied`,
  - **resolve gates** → when `mode: "ui"` and gates enabled, the run holds at `approveTop3`/`approveWinner` until Approved (Reject vetoes + escalates). Headless and `continueWithoutPause` auto-resolve.
- **Gates** — gate hold waits for WS resolution, escalates on timeout (default 10 min, configurable).

### What degrades (expected on example event with fake URLs)
- `data-analyst` — empty findings (no data files). Correct.
- `sponsor-stakeholder-analyst` / `past-winners-analyst` — low confidence (fake URLs unreachable). Correct.

### What's left to ship
- **Real-event demo** — point at a real hackathon URL to validate research quality on live inputs.
- **Reviewer tuning** — reviewers currently all REVISE (correct for thin example event; richer events should see approvals).
- **Failure-matrix explicit tests** — add a test per degraded path (missing website, LLM error, non-convergence, gate timeout) and a `--dry-run` offline mode.

## Known Issues

- **Gateway CCR compression**: OmniRoute and LiteLLM compress user messages >~800 chars into `[CCR retrieve]` stubs. All persona context MUST be in the system prompt (implemented). Re-verify threshold with `scripts/control-room-smoke.mts` or a raw call if gateway config changes.
- **Interject timing**: a directive sent after the loop's last review round is recorded but never applied (the run has already finished). The UI disables sending after `run complete`; acceptable.
- **Gate semantics**: rejecting a gate does NOT re-run the loop — it vetoes and marks the outcome `escalated`. A true "re-deliberate on veto" flow is future work.
- `pnpm build` gates green: typecheck ✓ lint ✓ test (70/70) ✓ build ✓.

## Entry Log (append-only, newest last)