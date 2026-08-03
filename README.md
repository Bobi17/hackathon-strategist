# Hackathon Strategist ⚡

A multi-agent research & ideation system that tells a hackathon team **what to build to win** — before anyone writes code. It ingests the event website, problem statements, and data; researches sponsors, judges, audience, and past winners; generates candidate ideas; and iterates a **debate-and-refine loop** until a panel of reviewer personas (including a rubric-expert Judge and a build-feasibility PM) approves a **Top 3** and a winning solution.

Output: a `spec.md` + `implementation-plan.md` the build team can execute immediately.

## Quick Start (5 minutes)

```bash
# 1. Clone or navigate to the project
cd hackathon-strategist

# 2. Install dependencies
pnpm install

# 3. Configure your LLM provider (pick ONE)
cp .env.example .env.local
#    Edit .env.local — url, key, and model are read ONLY from this file:
#    - OMNIROUTE_API_KEY / OMNIROUTE_BASE_URL / OMNIROUTE_MODEL
#    - LITELLM_API_KEY / LITELLM_BASE_URL / LITELLM_MODEL
#    - ANTHROPIC_API_KEY / ANTHROPIC_MODEL  (+ optional ANTHROPIC_BASE_URL)

# 4. Run against the example event (stubbed personas — no LLM calls yet)
pnpm strategist:run -c config/events/example.json

# 5. Check the output
ls output/example/
# spec.md  implementation-plan.md  shortlist.md  loop-log.md  ...
```

## What's Working Now

| Component | Status | Detail |
|---|---|---|
| Config system | ✅ | `EventConfig` types, JSON schema validation, per-event configs in `config/events/` |
| Ingestion pipeline | ✅ | Fetches event URLs, normalizes HTML, caches, profiles local data files |
| Stage machine | ✅ | Drives stages: ingest → research → synthesize → ideate → loop → finalize → artifacts |
| Budget governor | ✅ | Enforces research hours, max rounds, per-round time limits |
| Deliberation loop | ✅ | Iterative debate → score → review → approve/revise with non-convergence detection |
| Weighted scoring | ✅ | 6-criterion model (25/20/20/15/10/10) with sensitivity analysis |
| Event bus | ✅ | Typed `LoopEvent[]` stream powers both loop-log.md and the control-room WS |
| Artifact writer | ✅ | Writes all 8 markdown files (spec.md, plan, dossier, loop-log, etc.) |
| LLM client | ✅ | Multi-provider: Anthropic SDK / OmniRoute / LiteLLM, auto-detected from env |
| Persona files | ✅ | 12 `.agents/personas/` files with charters, tools, evidence discipline |
| Research via LLM | ✅ | 4 research personas run in parallel via `runPersonaById`, degrade to stubs on failure |
| Ideation via LLM | ✅ | Innovation Scout generates 5-8 idea cards (robust JSON extraction) |
| Debate via LLM | ✅ | Devil's Advocate critiques with citations each round |
| Review via LLM | ✅ | Judge + Sponsor + Audience + Feasibility panel, per-idea verdicts |
| Graceful degradation | ✅ | Persona failures fall back to deterministic stubs with `⚠ degraded` flags |
| Empty-output retry | ✅ | Gateway returning an empty body → retried once before degrading |
| **Control room (Phase 4)** | ✅ | WS stream, live transcript, scoring board, verdicts, interject, gates |
| Tests | ✅ | 44 tests: unit + orchestrator E2E (stubs) + WS/gate integration + sensitivity |

## Execution: Step by Step

### Prerequisites
- **Node.js ≥ 22.12** (`node -v`)
- **pnpm** (`pnpm -v`) — this project uses `pnpm` exclusively
- **One LLM provider** running and accessible:
  - [OmniRoute](http://localhost:2016/v1) at `http://localhost:2016/v1`
  - [LiteLLM](http://localhost:4000/v1) at `http://localhost:4000/v1`
  - Or an Anthropic API key (direct)

### Step 1 — Install

```bash
cd hackathon-strategist
pnpm install
```

### Step 2 — Configure

```bash
cp .env.example .env.local
```

Edit `.env.local` and set **exactly one** provider — **all** of its key, URL, and
model (nothing is hardcoded; a missing value fails fast):

```bash
# Option A: OmniRoute (priority 1)
OMNIROUTE_API_KEY=your-key-here
OMNIROUTE_BASE_URL=http://localhost:2016/v1
OMNIROUTE_MODEL=anthropic/claude-sonnet-4-5-20250514

# Option B: LiteLLM (priority 2)
LITELLM_API_KEY=your-key-here
LITELLM_BASE_URL=http://localhost:4000/v1
LITELLM_MODEL=openai/gpt-4o

# Option C: Anthropic direct (priority 3) — base URL optional (official API)
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-5-20250514
```

### Step 3 — Create an event config

Copy the example and edit for your hackathon:

```bash
mkdir -p config/events/my-event
cp config/events/example.json config/events/my-event/event.json
```

Edit `config/events/my-event/event.json`:

```json
{
  "slug": "my-event",
  "name": "My Hackathon 2026",
  "websiteUrls": ["https://my-hackathon.com"],
  "problemStatements": [
    "Build an AI solution for..."
  ],
  "dataFiles": ["config/events/my-event/dataset.csv"],
  "team": {
    "size": 4,
    "skills": ["typescript", "react", "llm", "python"]
  },
  "mode": "headless",
  "budgets": {
    "researchHours": 2,
    "maxRounds": 3
  }
}
```

Required fields: `slug`, `name`, `websiteUrls` (≥1), `problemStatements` (≥1), `team`.

### Step 4 — Run

```bash
# Headless (default)
pnpm strategist:run -c config/events/my-event/event.json

# With the live control room — build the UI first, then:
pnpm build
pnpm strategist:run -c config/events/my-event/event.json --ui
# Open http://localhost:8787 to watch the run live
```

In `--ui` mode the server starts **before** the run, replays the full event
stream to any tab that connects, and keeps serving the finished transcript
after the run completes (Ctrl-C to exit). Port: `CONTROL_ROOM_PORT` (default `8787`).

### Control room

The control room is the human-in-the-loop surface for a run:

- **Transcript** — every stage, research finding, debate message, score, verdict,
  directive, and gate streams live over WebSocket (`/ws`) as it happens.
- **Scoring board** — weighted totals and ranks per round, with a round selector.
- **Reviewer verdicts** — approve/revise chips with the concrete feedback.
- **Interject** — send a directive to a reviewer persona (or all). It is injected
  into that persona's context on the next review round and recorded in the loop log.
- **Gates** — when the config sets `mode: "ui"` and `gates.approveTop3` /
  `gates.approveWinner`, the run holds at those checkpoints until you click
  **Approve** (or **Reject**, which vetoes and escalates). Headless runs and
  `budgets.continueWithoutPause: true` auto-resolve gates without blocking.

### Step 5 — Inspect output

```bash
ls output/my-event/
# spec.md                    — winning solution spec
# implementation-plan.md     — MVP scope + build plan
# executive-summary.md       — 150-word winner summary
# shortlist.md               — Top 3 comparative matrix
# evidence-dossier.md        — research findings with citations
# loop-log.md                — debate rounds, verdicts, revisions
# approval-sheet.md          — per-reviewer verdicts
# decision-brief.md          — scoring model + sensitivity
```

## Project Structure

```
hackathon-strategist/
  prompt.md                    # architect brief (source of truth for requirements)
  spec.md                      # product spec ("what")
  IMPLEMENTATION_PLAN.md       # engineering spec ("how") — all 9 architect deliverables
  AGENTS.md                    # master directive for implementation agents
  RUBRIC.md                    # Judge's scoring sheet (weighted decision model)
  HANDOFF.md                   # session handoff ledger
  .env.example                 # env contract (LLM provider url/key/model)
  .agents/                     # lean context system
    personas/                  # 12 runtime persona definitions (LLM system prompts)
    rules/                     # engineering, orchestration, evidence
    skills/                    # web-ingest, data-analysis, debate-protocol
    registry.json              # personas + skills + routing table
  config/events/               # per-event config JSONs
  src/
    main.ts                    # CLI entry (pnpm strategist:run)
    main.tsx                   # React entry (control room)
    config/                    # EventConfig types, schema, defaults
    data/                      # Domain types, scoring engine, idea pool
    engine/                    # Stage machine, budget governor, deliberation loop, orchestrator
    agents/                    # LLM client (multi-provider), persona runner, tools, registry
    research/                  # Ingestion pipeline + parsers
    artifacts/                 # Markdown artifact writer + templates
    control-room/              # WS+HTTP server, directive broker, React UI
  output/                      # generated artifacts (gitignored)
```

## Architecture (in brief)

```
INPUTS                    ENGINE                          OUTPUTS
event URLs ──┐  ┌─────────────────────────────────┐  ┌── spec.md
problem stmts ─┤  │ Orchestrator                    │  ├── implementation-plan.md
datasets ─────┤  │  stage machine · budget governor │  ├── shortlist.md
rubric ───────┘  │        │                         │  ├── loop-log.md
                 │  Personas (12, LLM-driven)       │  ├── approval-sheet.md
                 │  EventBus → LoopEvent[]          │  ├── decision-brief.md
                 └──────────┬───────────────────────┘  └── ...
                            │ WS/SSE
                 ┌──────────▼───────────────────────┐
                 │ Control Room (React, optional)    │
                 │  transcript · scoring · interject │
                 └──────────────────────────────────┘
```

## What's Next (Remaining Work)

1. **Real-event demo** — point the Strategist at a real hackathon (URL + problem + data) to validate research quality on live inputs. The example event uses fake URLs.
2. **Reviewer tuning** — calibrate the Judge and panel on real event data; the panel currently leans revise on thin inputs.
3. **Failure-matrix hardening** — explicit tests for each degraded path (missing website, LLM error, non-convergence, gate timeout) and a `--dry-run` offline mode.

## License

Private — internal use only.
