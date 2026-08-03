---
active: LLM provider url/key/model now sourced only from .env.local (no hardcoded fallbacks)
owner: unassigned
handoff-count: 6
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
| 5 — Harden & ship | — | ✅ done | 45 tests, winner-selection bug fixed, reviewer tuning for open-ended events, real Cursor Hackathon SAIT run completed |
| 5 — Harden & ship | — | ⚠️ mostly done | README ✅, 44 tests ✅, empty-output retry ✅, sensitivity sign-bug fixed ✅; needs real-event demo + reviewer tuning |

## Current State

**The core system works end-to-end with real LLM calls at every stage.** Verified
against OmniRoute (`OMNIROUTE_API_KEY` → `http://localhost:2016/v1`, model `auto`,
resolves to `big-pickle`). **Phase 4 (control room) is shipped and smoke-tested.**

### What works now
- **Config validation** — `EventConfig` schema + defaults + per-event JSONs.
- **Ingestion** — fetches event URLs (with cache), parses local data files, flags gaps.
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
- `pnpm build` gates green: typecheck ✓ lint ✓ test (44/44) ✓ build ✓.

## Entry Log (append-only, newest last)

- [2026-08-02] claude-code — **LLM config is now 100% env-sourced**: added `src/config/env.ts` (`loadEnv()` via Node `process.loadEnvFile` reads `.env.local`; `requireEnv()` fails fast). Root cause: `.env.local` was never loaded into the process, so hardcoded fallbacks (`LITELLM_MODEL → 'claude-sonnet'`, `OMNIROUTE_BASE_URL → localhost:2016`, `ANTHROPIC_MODEL → claude-sonnet-4-5-…`) were silently used — that's the LiteLLM "wrong model" failure. Removed every `?? default` for provider url/model; `detectProvider()` now builds config lazily from env and throws a clear "set it in .env.local" error when a required var is missing. `main.ts` calls `loadEnv()` before detection; `ANTHROPIC_BASE_URL` is now actually wired into the Anthropic SDK client (was documented but ignored). `.env.example` + README updated (no more "default" claims). Verified: provider detection reads `.env.local`, missing model throws, full headless run succeeds (`omniroute → auto`, approved). 45 tests green.
- [2026-08-02] claude-code — **rebranded to Hackathon Strategist** (was Hackathon Oracle): package name `hackathon-strategist`, CLI scripts `strategist:run`/`strategist:dev`, hook `useOracleStream.ts` → `useStrategistStream.ts` (`OracleState` → `StrategistState`), config type `OracleMode` → `StrategistMode`, User-Agent `HackathonStrategist/0.1`, UI title "⚡ Hackathon Strategist", all docs (README/spec/IMPLEMENTATION_PLAN/AGENTS/RUBRIC/prompt/.agents) rebranded; CLI command normalized everywhere to `pnpm strategist:run` (was inconsistently `oracle:run` / `oracle run`). Root folder rename `hackathon-oracle` → `hackathon-strategist` verified with `pnpm build` green.
- [2026-08-02] claude-code — shipped Phase 4 control room: `src/control-room/server.ts` (HTTP static + WS `/ws`, replay-on-connect, gate hold/approve/escalate, interject ingest), `broker.ts` (DirectiveBroker — directive lifecycle + per-round consumed tracking), React UI (`useOracleStream` hook + StageRail/Transcript/ScoreBoard/VerdictPanel/Gates/Interject), `--ui` CLI wiring (server starts before run, keeps serving after). Wired `message` events for research/synthesis/ideation/debate; loop now stamps `directivesApplied` per round; review callbacks inject human directives. Added `run` event kind.
- [2026-08-02] claude-code — hardening + integration: empty-output retry in `tryRun` (gateway blank responses retried once); fixed a real sign bug in `sensitivityAnalysis` (`winnerPos - newPos` was inverted vs its docstring — now positive = winner drops, caught by new test). Added 18 tests (44 total): orchestrator E2E on stubs (outcome + all 8 artifacts), DirectiveBroker lifecycle, ControlRoomServer WS replay/live/interject/gate-approve/gate-reject/auto-resolve/gate-timeout/static-serve, sensitivity, empty-retry. Verified control room live end-to-end via `scripts/control-room-smoke.mts` (spawns oracle `--ui`, asserts HTTP + WS replay + interject directive stream + run complete).
- [2026-08-02] claude-code — LLM personas fully wired: `persona-tasks.ts` (research/synthesize/ideate callbacks + `makeDebateCallback`/`makeScoreCallback`/`makeReviewCallback`), structured coercion (`toIdeaCards`/`toScores`/`toVerdict` etc.), robust `extractJSON`. Runner context architecture: all context in system prompt (survives gateway CCR), tools-only for research personas, `maxTokens: 16000` for ideation. Verified end-to-end: 13 findings, real synthesis, 6 ideas, real differential scores, per-idea reviewer verdicts, 8 artifacts written. Escalated after 2 rounds (correct for example event with missing website/data).
- [2026-08-02] claude-code — discovered gateway CCR compression constraint: OmniRoute/LiteLLM compress user messages >~800 chars into `[CCR retrieve]` stubs. Fix: system-prompt context architecture. Discovered `extractJSON` needs robust repair: unescaped control chars, trailing prose, truncated output salvage. Both fixed + tests.
- [2026-08-02] claude-code — added multi-provider LLM client (`src/agents/llm.ts`) supporting OmniRoute, LiteLLM, and Anthropic direct, auto-detected; `stream: false` for OpenAI-compatible endpoints; `ANTHROPIC_MODEL` env honored; provider defaults match real infra (litellm: `claude-sonnet`, omniroute: `auto`).
- [2026-08-02] claude-code — built Phases 0–3: config system, domain types, event bus, scoring engine, stage machine, budget governor, deliberation loop, artifact writer (8 md files), multi-provider LLM client, persona runner + tools + registry, ingest + html/csv parsers, headless CLI. All gates green.
- [2026-08-02] enterprise-architect — spec-first scaffold: `IMPLEMENTATION_PLAN.md`, `spec.md`, `AGENTS.md`, `RUBRIC.md`, `.agents/` (12 personas, 3 rules, 3 skills, registry). Target runtime: TS/Node + Anthropic SDK + React control room.
