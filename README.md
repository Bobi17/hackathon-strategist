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

## Container Setup & Run (Docker) 🐳

The recommended way to run the Strategist in a production-like, isolated
environment. The `Dockerfile` bakes in Node 22 + Playwright's Chromium system
libraries, and the app runs as a non-root `strategist` user — no host browser,
no global installs, no arbitrary network egress. This is the same code path as
the local run; only the environment is sandboxed.

### Prerequisites
- **Docker** ≥ 24 with **Compose v2** (`docker --version`, `docker compose version`)
- The same **one LLM provider** as a local run (set in `.env.local` below)

### Step A — Build the image

```bash
cd hackathon-strategist
docker compose build
```

### Step B — Configure (on the host)

The container reads your event config and env read-only via volume mounts, so
create them on the host before running:

```bash
cp .env.example .env.local                      # set exactly one LLM provider (url/key/model)
mkdir -p config/events/my-event
cp config/events/example.json config/events/my-event/event.json   # then edit
```

### Step C — Run

All three run modes are supported. Artifacts are written to `./output/` on the
host (volume-mounted), so `ls output/my-event/` works after the run.

**1. Headless**

```bash
docker compose run --rm strategist pnpm strategist:run -c config/events/my-event/event.json
```

**2. Control room + config file (watch live)**

```bash
docker compose run --rm -p 8787:8787 strategist \
  pnpm strategist:run -c config/events/my-event/event.json --ui
# Open http://localhost:8787
```

**3. Control room — feed the event from the browser (interactive)**

```bash
docker compose run --rm -p 8787:8787 strategist pnpm strategist:run --ui
# Open http://localhost:8787 → fill in the form → Start run
```

### What the container enforces

| Mechanism | Effect |
|---|---|
| Non-root `strategist` user | No privileged file access inside the container |
| `config/` + `.env.local` mounted **read-only** | The app reads inputs but cannot modify them |
| Dedicated `research-net` bridge network | Isolated from the host network; only published ports are exposed |
| `output/` volume | Artifacts persist on the host; nothing else leaves the container |

> **Browser + paste ingestion inside Docker**: Playwright's Chromium and its
> system libraries are already in the image, so login-gated / JS-rendered pages
> work out of the box. The persistent login profile lives under
> `output/<slug>/.cache/browser-profile/`, which persists via the mounted volume.
> To reset a saved login, delete that directory on the host.

## What's Working Now

| Component | Status | Detail |
|---|---|---|
| Config system | ✅ | `EventConfig` types, JSON schema validation, per-event configs in `config/events/` |
| Ingestion pipeline | ✅ | Fetches event URLs, normalizes HTML, caches, profiles local data files |
| **Browser + paste ingestion** | ✅ | Chromium engine (Playwright) for login-gated / SPA pages; control-room paste fallback; persistent session profile |
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
| **Control room (Phase 4)** | ✅ | WS stream, live transcript, scoring board, verdicts, interject, gates, pick-winner |
| Tests | ✅ | 70 tests: unit + orchestrator E2E (stubs) + WS/gate/pick-winner/ingest-auth integration + escalation |

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
    "maxRounds": 3,
    "refineRounds": 3
  },
  "gates": {
    "approveTop3": false,
    "pickWinner": true
  }
}
```

`gates.pickWinner` (default `true`) presents the Top 3 for a pick-or-feedback
decision in UI mode; `budgets.refineRounds` (default `3`) caps how many
feedback→rewrite→re-deliberate cycles run before the top-ranked idea is taken.
`gates.approveWinner` is legacy and ignored — use `pickWinner`.

Required fields: `slug`, `name`, `websiteUrls` (≥1), `problemStatements` (≥1), `team`.

### Step 4 — Run

Three ways to run — pick the one that fits.

**1. Headless (no UI)**

```bash
pnpm strategist:run -c config/events/my-event/event.json
```

Runs the full pipeline and writes markdown artifacts to `output/<slug>/`.
No browser needed.

**2. Control room + config file (immediate run)**

```bash
pnpm build
pnpm strategist:run -c config/events/my-event/event.json --ui
# Open http://localhost:8787 to watch the run live
```

The server starts **before** the run, replays the full event stream to any
tab that connects, and keeps serving the finished transcript after the run
completes (Ctrl-C to exit).

**3. Control room — feed the event from the browser (interactive mode)**

```bash
pnpm build
pnpm strategist:run --ui
# Open http://localhost:8787 → fill in the form → Start run
```

Omit `--config` and the control room starts in **interactive mode** — no run
begins until you submit the event info from the browser. The launch form
covers every `EventConfig` field: event name, website URLs, problem
statements, data files, sponsors, team size/skills, budgets, and gate
checkpoints. A **JSON paste mode** lets you paste a full `config/events/*.json`
instead of filling in the form.

Port: `CONTROL_ROOM_PORT` (default `8787`).

### Control room

The control room is the human-in-the-loop surface for a run:

- **Transcript** — every stage, research finding, debate message, score, verdict,
  directive, and gate streams live over WebSocket (`/ws`) as it happens.
- **Scoring board** — weighted totals and ranks per round, with a round selector.
- **Reviewer verdicts** — approve/revise chips with the concrete feedback.
- **Interject** — send a directive to a reviewer persona (or all). It is injected
  into that persona's context on the next review round and recorded in the loop log.
- **Gates** — when the config sets `mode: "ui"`, the run holds at checkpoints
  until you act. **Top 3** (`gates.approveTop3`): approve/reject the shortlist.
  **Pick the winner** (`gates.pickWinner`, default on): the Top 3 cards are
  presented — **★ Pick** one as the winner, or send **feedback** to rewrite
  those cards and re-deliberate (the refined Top 3 are re-presented, up to
  `budgets.refineRounds` iterations, default 3). **Ingest login gate**: when a
  website URL is login-walled or JS-rendered, a browser window opens — sign in
  and click **I've signed in**, or paste the page content. Headless runs and
  `budgets.continueWithoutPause: true` auto-resolve: the top-ranked idea is
  picked; gated URLs become gaps.

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
    research/                  # Ingestion pipeline + parsers + browser session
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

## Browser + paste ingestion

Hackathon sites (Devpost, Devfolio, sponsor sites, past-winners pages) often
require login or render content client-side via JavaScript. The ingestion
pipeline now handles both cases automatically:

**How it works** — per URL, the pipeline escalates up this chain:

1. **Plain fetch** (static HTML) — fast path; skips the browser entirely.
2. **Chromium render** (Playwright) — when the plain fetch returns thin or no
   content, or when `useBrowser: true` is set. A persistent Chromium profile
   stores cookies/localStorage so a login persists across URLs and re-runs.
3. **Interactive auth gate** (UI mode only) — a browser window opens at the
   gated URL; the human signs in, then clicks **I've signed in — continue**.
   Alternatively, paste the page content into the control room.
4. **Gap** — headless mode with no saved session: the URL is flagged as a gap
   and research runs on what it can.

**Install** (one-time, only needed when you actually hit a login/SPA page):

```bash
pnpm add playwright && pnpm exec playwright install chromium
# If system libraries are missing: pnpm exec playwright install-deps chromium
```

**Config flags** (optional, in your `config/events/*.json`):

| Flag | Type | Default | Purpose |
|---|---|---|---|
| `useBrowser` | `boolean` | `false` | Force the Chromium engine for all URLs (skip plain-fetch fast path). |
| `minContentChars` | `number` | `300` | Plain-fetched content shorter than this is treated as "thin" and escalated to the browser. |

**Session persistence**: the Chromium profile lives at
`output/<slug>/.cache/browser-profile/`. It survives across runs, so a second
run of the same event is already logged in. Delete that directory to log out
and reset.

**Persona webFetch**: research personas can also discover gated URLs mid-run via
their `webFetch` tool — those fetches automatically use the same logged-in
session. The paste fallback works even without Playwright installed.

## What's Next (Remaining Work)

1. **Real-event demo** — point the Strategist at a real hackathon (URL + problem + data) to validate research quality on live inputs. The example event uses fake URLs.
2. **Reviewer tuning** — calibrate the Judge and panel on real event data; the panel currently leans revise on thin inputs.
3. **Failure-matrix hardening** — explicit tests for each degraded path (missing website, LLM error, non-convergence, gate timeout) and a `--dry-run` offline mode.

## License

Private — internal use only.
