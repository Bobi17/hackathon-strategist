# Hackathon Strategist — Implementation Plan

> **How** the Hackathon Strategist is built. This is the detailed engineering spec
> that implements `prompt.md` and `spec.md`. It contains all nine required
> deliverables from the architect brief: context & architecture, agent roster,
> stage-gate workflow, data contracts, orchestration model, config model,
> failure matrix, build phases, and control-room UI design.
>
> Agents: read `AGENTS.md` and `HANDOFF.md` first, and update `HANDOFF.md`
> before ending a session. This file is the destination map.

## 0. Approach & Decisions

- **Stack (TS/Node + React):** TypeScript (strict, Node ≥ 22, pnpm, ESM). Personas run via the **Anthropic SDK** (Claude); orchestration is plain TypeScript — no agent framework — so the loop control, event bus, and artifacts are testable and deterministic. Control room is **React 19 + Vite 8 + Tailwind v4** (same stack as the `launchpad-ts` base we scaffold from).
- **Runtime personas are files:** each persona is a markdown file in `.agents/personas/` (the launchpad persona format). The LLM runner loads the file's frontmatter + body as the system prompt, so personas are editable without code.
- **Lean context system:** the Strategist's `.agents/` carries only Strategist-specific personas, rules, and skills. The shared vendor catalog of skills/specs/personas lives in `launchpad-ts/.agents/` — reference it, don't duplicate it.
- **Headless-first:** the CLI run is the product; the control room is an optional view on the same event stream. No UI → same artifacts (FR6 parity).
- **Determinism:** same inputs + config ⇒ same shortlist. Keep round orchestration seeded and idempotent where possible; full determinism is best-effort given LLM sampling.

### System Context & Architecture

```
             ┌──────────────────────── HACKATHON STRATEGIST ────────────────────────┐
             │                                                                      │
  INPUTS     │  ENGINE                                                              │
 ─────────   │  ┌────────────────────────────────────────────────────┐              │
 event URLs  │  │ Orchestrator:  stage machine · budget governor      │              │
 problem st. │  │              · gate keeper · event bus publisher   │              │
 datasets    │──▶│                                                  │──▶  Artifacts  │
 rubric      │  │   ingest → research → synthesize → ideate →        │     output/<   │
 past winners│  │   [debate loop: debate→score→review→approve?]      │     event>/    │
              │  │                  → finalize                        │     *.md files │
              │  └───────────────────────┬────────────────────────────┘              │
              │                          │ routes personas via the runner            │
              │  ┌───────────────────────▼────────────────────────────┐   ┌───────────┐│
              │  │ Personas (12): system prompt from .agents/personas/ │   │ Control    ││
              │  │  run on Claude via Anthropic SDK                    │   │ Room       ││
              │  │  tools: webFetch · readFile/glob · csv/json/parse   │   │ (React,    ││
              │  │  EventBus emits LoopEvent[]                         │──▶│  optional)  ││
              │  └─────────────────────────────────────────────────────┘   │ WS/SSE    ││
              │        ▲ human directives & gate decisions (POST) ─────────│ interject  ││
              └────────┴────────────────────────────────────────────────────┴───────────┘
```

## 1. Agent Roster — role, charter, tools, I/O

Each persona is a file in `.agents/personas/<category>/<slug>.md`. The runner injects **tools** by role; all personas inherit the evidence rule (`.agents/rules/evidence.md`).

| # | Persona (slug) | Category | Charter (I/O) | Tools |
|---|---|---|---|---|
| 1 | **Orchestrator** (`orchestrator`) | orchestration | Owns the run: stage transitions, budgets, gates, dispatch. In: `EventConfig`, stage signals. Out: stage directives, gate decisions, escalation. | full (dispatch, read logs) |
| 2 | **Event Intelligence Analyst** (`event-intelligence-analyst`) | research | Event format, duration, tracks, tech requirements, submission rules, dates. In: ingested website. Out: `ResearchFinding[]`. | webFetch, readFile |
| 3 | **Sponsor & Stakeholder Analyst** (`sponsor-stakeholder-analyst`) | research | Each sponsor's industry/goals/tracks/prizes; judges' backgrounds; audience profile. In: site, sponsor list. Out: findings + sponsor scorecard. | webFetch, readFile |
| 4 | **Past-Winners Analyst** (`past-winners-analyst`) | research | What won this/similar events and *why* (patterns: domain, tech, demo-ability). In: past-winner URLs. Out: patterns + citations. | webFetch |
| 5 | **Data Analyst** (`data-analyst`) | research | Dataset schema/size/quality/distribution/signals; what solution classes the data enables. In: data files. Out: data insights + leverage map. | readFile, csv/json/parse, summarize |
| 6 | **Innovation Scout** (`innovation-scout`) | creation | Divergent idea generation (10–20 cards). In: synthesized findings. Out: `IdeaCard[]`. | readFile (findings) |
| 7 | **Devil's Advocate** (`devils-advocate`) | creation | Adversarial critique of every candidate; rebuttals. In: idea cards + findings. Out: debate messages. | readFile |
| 8 | **Synthesis & Decision Lead** (`decision-lead`) | decision | Applies feedback, scores, drives the loop, drafts artifacts. In: cards, feedback, verdicts. Out: scores, Top 3, winner, artifact drafts. | readFile, writeArtifacts |
| 9 | **Judge (Rubric & Gating Expert)** (`judge`) | reviewer | Owns the event rubric + gating rules; criterion-by-criterion verdict. In: cards, `RUBRIC.md`, gating rules. Out: `ReviewerVerdict` + rubric scores. | readFile (rubric) |
| 10 | **Sponsor Reviewer** (`sponsor-reviewer`) | reviewer | Reviews from each sponsor's goals/tracks/prizes. In: cards, sponsor scorecard. Out: verdict. | readFile |
| 11 | **Audience Reviewer** (`audience-reviewer`) | reviewer | Demo-compelling, adoptable, first-paint wow. In: cards. Out: verdict. | readFile |
| 12 | **Build Feasibility Reviewer / PM** (`build-feasibility-reviewer`) | reviewer | MVP decomposition, effort vs. build window & team, scope-cuts. In: cards, `team`, `budgets`. Out: verdict + feasibility assessment. | readFile |

**Reviewer Panel** = personas 9–12 (Judge carries the most weight). Panel membership is config-driven and extensible.

## 2. Stage-Gate Workflow

### Stages (linear once; only the loop iterates)

```
 ingest → research → synthesize → ideate → [deliberation loop] → finalize → artifacts
```

| Stage | Entry criteria | Work | Exit criteria (gate) |
|---|---|---|---|
| **ingest** | config valid | fetch/normalize website; ingest problem statements, data files, rubric, gating rules | inputs validated; missing critical inputs flagged with assumptions |
| **research** | ingested inputs | run personas 2–5 in parallel | each returns findings with citations + confidence |
| **synthesize** | all research done | Decision Lead merges findings into constraints/opportunities | synthesis doc written; no unresolved rabbit-holes |
| **ideate** | synthesis ready | Innovation Scout produces 10–20 idea cards; PM sanity-checks scope | idea pool ≥ 6 viable cards; all map verbatim to the prompt |
| **deliberation loop** | idea pool ready | see round protocol below | all reviewers Approve, **or** max rounds hit → escalate |
| **finalize** | loop approved | Decision Lead selects Top 3 + winner, writes rationale | winner + runner-up flip conditions recorded |
| **artifacts** | finalize done | artifact writer renders all 8 markdown files | files exist under `output/<slug>/`; acceptance checks pass |

### Deliberation loop — round protocol

Each round (1..N):
1. **Debate** — Devil's Advocate critiques each surviving candidate; rebuttals allowed; every claim cited.
2. **Refine & score** — Decision Lead applies prior feedback (and any pending human directives), then scores on the weighted model (§3.3) and normalizes.
3. **Reviewer assessment** — the Reviewer Panel reviews the current shortlist. Each persona returns **Approve** or **Revise** with `FeedbackItem[]`. The Judge scores criterion-by-criterion; the PM may propose MVP-scope cuts.
4. **Loop control** — all Approve ⇒ exit to `finalize`. Any Revise ⇒ collect feedback, start round N+1. **Feedback → revision traceability:** every round's revision lists the feedback items it addresses.

**Termination & escalation:**
- Ends on **unanimous approval**, or when `budgets.maxRounds` (default 3) is exhausted.
- On exhaustion, escalate to the human (control room or CLI prompt) with the **dissent log** and unfinished objections; the human picks a winner or requests one more round.
- The loop **converges**: each round narrows the pool or tightens scores; a round that makes no progress (no feedback addressed, no scores moved) is a non-convergence signal → escalate.

## 3. Data & Interface Contracts

### 3.1 Core domain types (`src/data/types.ts`)

```ts
type PersonaId =
  | 'orchestrator' | 'event-intelligence-analyst' | 'sponsor-stakeholder-analyst'
  | 'past-winners-analyst' | 'data-analyst' | 'innovation-scout' | 'devils-advocate'
  | 'decision-lead' | 'judge' | 'sponsor-reviewer' | 'audience-reviewer'
  | 'build-feasibility-reviewer';

type PanelPersonaId = 'judge' | 'sponsor-reviewer' | 'audience-reviewer' | 'build-feasibility-reviewer';

type Stage = 'ingest' | 'research' | 'synthesize' | 'ideate' | 'loop' | 'finalize' | 'artifacts';
type Confidence = 'high' | 'medium' | 'low';

interface Evidence { source: string; confidence: Confidence; note?: string }
interface ResearchFinding { role: PersonaId; section: string; claim: string; evidence: Evidence[] }

interface IdeaCard {
  id: string;                       // slug-<n>
  oneLinePitch: string;
  problemFit: string;               // verbatim prompt mapping
  targetUser: string;
  techApproach: string;
  differentiator: string;
  dataLeverage: string;
  gatingFit: string;
  buildScope: string;
  feasibility?: FeasibilityAssessment;   // set by build-feasibility-reviewer
}
interface FeasibilityAssessment { buildWindowHours: number; effortHours: number; risk: 'low'|'med'|'high'; cuts: string[] }

interface ScoreWeights { problemFit: number; feasibility: number; innovation: number;
  stakeholderAlignment: number; dataLeverage: number; demoAbility: number }
const DEFAULT_WEIGHTS: ScoreWeights =
  { problemFit: 0.25, feasibility: 0.20, innovation: 0.20,
    stakeholderAlignment: 0.15, dataLeverage: 0.10, demoAbility: 0.10 };

interface Score { ideaId: string; criteria: Record<keyof ScoreWeights, number>; total: number; rank?: number }
interface FeedbackItem { topic: string; issue: string; requiredChange: string; evidence?: Evidence }
interface ReviewerVerdict { reviewer: PanelPersonaId; verdict: 'approve'|'revise'; feedback: FeedbackItem[]; rubricScores?: Record<string, number> }
interface HumanDirective { id: string; at: number; from: 'human'; target: PanelPersonaId | 'all'; message: string }

interface DeliberationRound {
  number: number; candidates: IdeaCard[]; scores: Score[];
  debate: { persona: PersonaId; text: string; citations: string[] }[];
  verdicts: ReviewerVerdict[]; directivesApplied: HumanDirective[];
  revisions: { feedbackId: string; whatChanged: string }[];   // traceability
}
interface LoopOutcome {
  status: 'approved' | 'escalated';
  rounds: DeliberationRound[]; top3: IdeaCard[]; winner: IdeaCard;
  approvals: Record<PanelPersonaId, boolean>;
  dissentLog: { reviewer: PanelPersonaId; objection: string }[];
}
```

### 3.2 Event bus — stream contract

```ts
type LoopEvent =
  | { kind: 'stage'; stage: Stage; at: number }
  | { kind: 'round'; number: number; action: 'start' | 'end' }
  | { kind: 'message'; round: number; persona: PersonaId; text: string; citations: string[] }
  | { kind: 'score'; round: number; scores: Score[] }
  | { kind: 'verdict'; round: number; verdict: ReviewerVerdict }
  | { kind: 'directive'; directive: HumanDirective; accepted: boolean }
  | { kind: 'gate'; gate: string; decision: 'requested' | 'resolved' | 'escalated' };
```

`LoopEvent[]` is the single source for **both** the control-room stream (JSON lines over WS/SSE) and `loop-log.md`. Wire format: `{ seq: number; ts: number; ...event }`.

### 3.3 Weighted decision model (config-driven, defaults)

| Criterion | Weight | Default | Who provides evidence |
|---|---|---|---|
| Problem–Solution Fit | 25% | `problemFit: 0.25` | Innovation Scout cards, Judge |
| Feasibility in build window | 20% | `feasibility: 0.20` | Build Feasibility Reviewer |
| Innovation / Differentiation | 20% | `innovation: 0.20` | Devil's Advocate, Judge |
| Stakeholder Alignment | 15% | `stakeholderAlignment: 0.15` | Sponsor Reviewer, Audience Reviewer |
| Data Leverage | 10% | `dataLeverage: 0.10` | Data Analyst |
| Demo-ability | 10% | `demoAbility: 0.10` | Audience Reviewer |

Scores are 0–10 per criterion; `total = Σ(scoreᵢ × weightᵢ)`. **Sensitivity:** `decision-brief.md` reports how much each criterion moved the final rank (recompute ranks dropping one criterion at a time).

### 3.4 Output artifacts (markdown schema)

Every artifact is written under `output/<event-slug>/` (config `outputDir`):

| File | Contents |
|---|---|
| `spec.md` | winning solution: verbatim problem, target user, features, differentiator, tech stack, data model, gating-fit, risks |
| `implementation-plan.md` | MVP scope + cuts, phases mapped to the event clock, task breakdown, DoD, demo script, deploy steps |
| `executive-summary.md` | ≤150 words: what, for whom, why it wins, what to build first |
| `shortlist.md` | Top-3 comparative matrix (idea × criterion) with scores & trade-offs |
| `evidence-dossier.md` | all research findings with citations; sponsor/judge/audience analysis; past-winner patterns; data insights |
| `loop-log.md` | per round: debate, verdicts, feedback, revisions, human directives (incl. full interjection text) |
| `approval-sheet.md` | per-reviewer final verdicts + any dissents carried into the decision |
| `decision-brief.md` | scoring model, weights, sensitivity analysis, runner-up flip conditions |

Artifact writer renders from typed state via templates in `src/artifacts/templates/` — never from agent prose directly (agents draft, the writer validates + persists).

## 4. Orchestration & Concurrency Model

- **Orchestrator** (`src/engine/orchestrator.ts`) owns the stage machine, budget governor, and gate keeper. It **dispatches** persona runs via the runner and consumes their structured outputs; personas never call each other directly.
- **Concurrency:** research personas (2–5) run in **parallel** (fan-out, bounded to `config.concurrency`); debate is **serial**; reviewer assessment (9–12) runs in **parallel** per round. All writes to the event bus are serialized.
- **Budget governor** (`src/engine/budget-governor.ts`): converts `budgets` (research hours, max rounds, per-round minutes) into hard stage timeboxes; when a stage exceeds its box, it stops collecting input and moves on with a clearly-flagged gap (degradation, §6).
- **Gate keeper:** enforces the human gates (`approveTop3`, `approveWinner`) in UI mode by pausing the run and waiting for a gate event; in headless mode gates default to approved unless `mode: 'ui'`.
- **Reviewer Panel approval protocol:** all panel verdicts must be `approve` for the round to pass. A `revise` from any panelist (with rationale — see rule) triggers the next round. Dissents recorded even on approval (`approval-sheet.md`).
- **Human directives:** accepted only at round boundaries (or immediately if `budgets.continueWithoutPause`). They are injected as `HumanDirective` events, forced into the Decision Lead's next-round context, and logged.

## 5. Config Model

`config/events/<event>.json` (validated against `src/config/schema.ts`). Defaults in `src/config/defaults.ts`.

```ts
interface EventConfig {
  slug: string; name: string;
  websiteUrls: string[];
  problemStatements: string[];
  dataFiles?: string[];              // paths, may be absolute
  rubricUrl?: string;                // judges' scoring sheet, if available
  sponsors?: { name: string; url?: string; track?: string; prize?: string }[];
  pastWinnersUrls?: string[];
  team: { size: number; skills: string[] };          // REQUIRED for feasibility
  weights?: Partial<ScoreWeights>;                   // optional override
  budgets?: {
    researchHours?: number;          // default 3
    maxRounds?: number;              // default 3
    perRoundMinutes?: number;        // default 20
    continueWithoutPause?: boolean;  // default false
  };
  mode: 'headless' | 'ui';
  gates?: { approveTop3?: boolean; approveWinner?: boolean };  // default true in ui mode
  outputDir?: string;                // default output/
  model?: Record<PersonaId, string>; // per-persona model override; unset → provider's *_MODEL from .env.local
  concurrency?: number;              // default 4
}
```

### Example `config/events/example.json`

```json
{
  "slug": "example",
  "name": "Example AI Hackathon 2026",
  "websiteUrls": ["https://example-hackathon.dev"],
  "problemStatements": ["Build an AI solution for supply-chain visibility"],
  "dataFiles": ["config/events/example/dataset.csv"],
  "sponsors": [{ "name": "ACME Logistics", "track": "Supply chain AI" }],
  "pastWinnersUrls": ["https://example-hackathon.dev/2025-winners"],
  "team": { "size": 3, "skills": ["typescript", "react", "llm"] },
  "mode": "ui",
  "budgets": { "researchHours": 2, "maxRounds": 3 }
}
```

## 6. Failure & Degradation Matrix

| Condition | Behavior (no crash) | Escalation / note |
|---|---|---|
| Event site unreachable / JS-heavy | Retry once; then ingest pasted content or flag `missing website` with assumptions | logged as `low`-confidence findings |
| No problem statement | Abort ingest with explicit error — this is mandatory input | human must supply |
| No judging rubric | Judge uses `RUBRIC.md` defaults + clearly-labeled assumption | flagged in `decision-brief.md` |
| No datasets | `dataLeverage` weight dropped to 0 and renormalized | flagged in dossier |
| A persona run fails (LLM/API error) | Retry ×2 with backoff; then degrade to a deterministic stub for that role (e.g., Judge auto-approves with "skipped") | surfaced in `loop-log.md` |
| Research stage over budget | Governor stops collecting, moves on with gap flagged | gap listed in synthesis |
| Non-converging loop (round makes no progress) | Escalate immediately (do not burn remaining rounds) | human decision |
| Human directive at wrong boundary | Queued, applied next round | noted in transcript |
| Control room down | Headless run proceeds; UI reconnects and replays events from the log | parity preserved |

## 7. Control-Room UI Design (optional component)

**Purpose:** a local web view of the live deliberation; the human can watch, interject, and resolve gates. Purely an observer/controller of the event bus — no decision logic lives in the UI (headless parity).

### Components (`src/control-room/`)
- **Server** (`server.ts`): Node `http` + `ws`. `GET /` serves the built React app; `WS /ws` streams `LoopEvent[]`; HTTP endpoints below.
- **Client** (React 19 + Tailwind v4, dark-mode-first like launchpad):
  - `Transcript` — streaming, grouped by round, speaker-colored per persona, citations expandable.
  - `StatusBar` — stage, round N/max, budget used, personas active/pending.
  - `ScoringBoard` — live idea × criterion matrix with rank changes.
  - `InterjectComposer` — target (panel persona | all) + message; POSTs a directive.
  - `GateDialog` — shows pending gates/escalation (e.g., pick a winner when the loop exhausts).

### API
```
WS   /ws                                    → LoopEvent[] stream
POST /api/directive   { target, message }   → { accepted, round }
POST /api/gate/:gate  { decision }          → resolves approveTop3 | approveWinner | escalation
POST /api/run/:action { start | pause | resume | stop }
GET  /api/state                             → current run snapshot (Round, scores, stage)
```

### Headless parity
- UI is optional (`mode: 'ui'`). Headless runs stream to a log file instead; artifacts identical.
- Every interjection/gate resolution is recorded in `loop-log.md`, so the human's input is reproducible and auditable.

## 8. Proposed File Tree (delta from the launchpad-ts base)

```text
hackathon-strategist/
  prompt.md                      # the architect brief (source of truth for requirements)
  spec.md                        # THIS product's "what"
  IMPLEMENTATION_PLAN.md         # THIS file — the "how"
  AGENTS.md · RUBRIC.md · HANDOFF.md · .env.example · .gitignore
  .agents/
    README.md                    # pointer to launchpad-ts for shared skills/specs/catalog
    registry.json                # 12 personas + skills + routing
    personas/                    # runtime persona definitions (one file per persona)
      orchestration/orchestrator.md
      research/event-intelligence-analyst.md
      research/sponsor-stakeholder-analyst.md
      research/past-winners-analyst.md
      research/data-analyst.md
      creation/innovation-scout.md
      creation/devils-advocate.md
      decision/decision-lead.md
      reviewer/judge.md
      reviewer/sponsor-reviewer.md
      reviewer/audience-reviewer.md
      reviewer/build-feasibility-reviewer.md
    rules/                       # engineering.md · orchestration.md · evidence.md
    skills/                      # web-ingest.md · data-analysis.md · debate-protocol.md
  config/
    defaults.ts · schema.ts · types.ts
    events/example.json
  src/
    main.ts                      # CLI: pnpm strategist:run --config <path> [--ui|--headless]
    server.ts                    # control-room server (http + ws)
    engine/
      event-bus.ts               # LoopEvent emit/subscribe + persistence hook
      stage-machine.ts           # stages + entry/exit gates
      deliberation-loop.ts       # round protocol + termination + escalation
      budget-governor.ts         # timeboxing
      orchestrator.ts            # dispatch, gates, directives
    agents/
      registry.ts                # load .agents/personas/*, routing
      runner.ts                  # run(persona, ctx, tools) -> structured output
      llm.ts                     # Anthropic SDK wrapper (retry, tokens, model map)
      tools.ts                   # tool registry: webFetch, readFile, csv/json/parse, summarize
    research/
      ingest.ts                  # fetch + normalize + cache
      parsers/html.ts csv.ts json.ts pdf.ts
      past-winners.ts · sponsors.ts
    data/
      types.ts · idea-pool.ts · scoring.ts
    artifacts/
      writer.ts                  # validate + persist markdown
      templates/*.md             # spec.md, implementation-plan.md, ... schemas
    control-room/
      server-stream.ts · client/ (React app)
  output/
    .gitkeep                     # artifacts are gitignored (like launchpad briefs)
```

## 9. Build Phases

- [ ] **Phase 0 — Scaffold & config:** copy base from `launchpad-ts` (package.json, tsconfig, Tailwind). Add deps: `@anthropic-ai/sdk`, `ws`, `cheerio`, `csv-parse`, `vitest`, `oxlint` (already), `react`/`vite` (already). Define `EventConfig` types + schema + defaults + `config/events/example.json`. Exit: config validates.
- [ ] **Phase 1 — Core domain & bus:** `src/data/types.ts`, `src/engine/event-bus.ts`, artifact writer + templates for all 8 md files. Exit: a stub run writes 8 files with `LoopOutcome` `approved`.
- [ ] **Phase 2 — Personas run for real:** `llm.ts` + `runner.ts` + `tools.ts`; load personas from `.agents/personas/`; wire research personas (2–5) in parallel; ingest + parsers. Exit: research returns cited findings for the example event.
- [ ] **Phase 3 — The loop:** scoring, `deliberation-loop.ts`, `stage-machine.ts`, `budget-governor.ts`, `orchestrator.ts`; headless CLI end-to-end. Exit: a forced Judge `revise` is addressed next round; run terminates approved **or** escalated (never unbounded).
- [ ] **Phase 4 — Control room:** `server.ts`, WS stream, React client (transcript, status, scoring board, interject, gate dialog). Exit: interject appears in next round + `loop-log.md`; headless parity check passes.
- [ ] **Phase 5 — Harden & ship:** failure matrix behaviors, retry/backoff, Playwright fallback (best-effort), tests (loop termination, scoring sensitivity, artifact schema), seed demo run, `AGENTS.md`/`HANDOFF.md`/`RUBRIC.md` finalized, `pnpm smoke`.

### Per-phase agent briefs
- Phase 1 → foundation agent: types + event bus + artifact writer (no LLM).
- Phase 2 → agent B consumes Phase 1: LLM runner + ingest + research personas.
- Phase 3 → agent C consumes Phase 2: loop + scoring + orchestrator + CLI.
- Phase 4 → agent D consumes Phase 3: control-room server + React client.
- Phase 5 → hardening agent across all.

## 10. Definition of Done

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green; no console errors.
- [ ] Headless run on `config/events/example.json` writes all 8 artifacts; acceptance criteria in `spec.md` §9 pass.
- [ ] Control-room run on the same event is artifact-identical (parity).
- [ ] A Judge-revise round is demonstrably addressed (feedback → revision traceability).
- [ ] `HANDOFF.md` updated; no stray files in `output/` or `.agent-logs/`.
- [ ] `docs/screenshots/` holds control-room desktop + mobile shots (from the launchpad base).
- [ ] Small, green, frequent commits — judges and reviewers read `git log`.
