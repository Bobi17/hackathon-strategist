# Hackathon Strategist — System Design Prompt

> Single source of truth for designing and building the **Hackathon Strategist**: a
> multi-agent research & ideation system that decides *what to build to win* a
> hackathon — grounded in event intel, sponsor/judge/audience research, past
> winners, and the provided data — before anything is coded.
>
> Hand the prompt below (Role → Acceptance Criteria) to the enterprise architect
> as-is. The Acceptance Criteria are the test that the resulting spec is
> complete and buildable.

---

### Role
You are a Principal Enterprise Architect. Translate the following business intent into a complete solution design and technical specification that a delivery team can implement without further clarification.

### Mission
Design and specify a **multi-agent Hackathon Research & Ideation System** ("the System") that, for any given hackathon: ingests the event's materials, researches the factors that determine winning, researches sponsors and audience, analyzes any provided data, generates candidate solution ideas, and **iterates a debate-and-refine loop until every reviewer persona — including a rubric-expert Judge — approves** the resulting **Top 3 and a single recommended winning solution** — grounded in evidence, not guesswork. The deliberation runs live in an optional **control-room UI** where a human can watch every persona discussion in real time and interject their perspective, and the run produces a **solution spec and implementation plan as Markdown files** the build team can execute immediately.

### Business Context
Hackathon teams have limited hours; the highest-leverage activity is choosing the right problem to solve. Today that choice is made hastily and intuitively. The System front-loads evidence into that decision — studying the event website, problem statements, provided datasets, sponsors, judges, audience, prize criteria, and past winners of the same or similar events — and produces a defensible, ranked recommendation the build team can act on immediately.

### Objectives & Success Criteria
1. **Evidence-first decisions** — every recommendation traces to cited research, not opinion.
2. **Time-boxed research** — the full ingest → research → ideate → shortlist cycle completes within a configurable budget (default: 3 hours) and never starves build time.
3. **Reusable across events** — parameterized per hackathon (URLs, problem statements, datasets, sponsor list, dates) with zero code changes.
4. **Actionable output** — the build team can start coding from the winning recommendation with no follow-up questions.
5. **Transparent reasoning** — the deliberation loop log shows how ideas were challenged, scored, revised, and eliminated.
6. **Consensus-gated approval** — nothing is finalized until every reviewer persona (Judge, Sponsor Reviewer, Audience Reviewer, Build Feasibility Reviewer) approves; dissents and escalations are always visible.
7. **Artifact-first output** — the run persists the winning solution as `spec.md` and `implementation-plan.md` (plus the full research package) into a configured output directory, ready for the build team.
8. **Optional human supervision** — an optional real-time control room streams the personas' live discussions and lets the human interject their perspective at any point; headless runs remain fully supported and produce identical results.

### Functional Requirements

**FR1 — Inputs & Ingestion**
- Accept heterogeneous inputs: hackathon website URL(s) (or pasted content), official problem statement(s) verbatim, supporting datasets/files (CSV, JSON, spreadsheets, PDFs), judging rubric (if available), sponsor & prize listings, and optional URLs of past winners.
- Fetch and normalize web content (strip boilerplate, handle nested/paginated pages, capture agenda/tracks/past-winners sections).
- Validate ingestion completeness; explicitly flag missing critical inputs (e.g., "no judging criteria found") and continue on best-available, clearly-labeled assumptions.

**FR2 — Research & Analysis Capabilities (agent roster)**
The System runs specialist roles, each with a defined charter:
1. **Event Intelligence Analyst** — event format, duration, tracks, tech requirements, submission rules, dates.
2. **Sponsor & Stakeholder Analyst** — each sponsor's industry, stated priorities, the challenge tracks they run, prizes; judges' backgrounds; the audience profile (who uses the output, adoption signal).
3. **Past-Winners Analyst** — submissions that won this or similar events; patterns in what won (domain, tech, production quality, demo-ability) and *why* (public commentary, judging notes).
4. **Data Analyst** — provided datasets: schema, size, quality, distribution, signals, hidden patterns; what solution classes the data enables or precludes.
5. **Innovation Scout** — divergent generation of candidate ideas (FR3).
6. **Devil's Advocate** — adversarial critique of every idea (FR4).
7. **Synthesis & Decision Lead** — runs the weighted scoring model, drives the deliberation loop (FR4): turns reviewer feedback into revisions, produces the Top 3 and final recommendation, writes the evidence dossier.
8. **Judge (Rubric & Gating Expert)** — owns the event's actual scoring sheet (its rubric — innovation/originality, technical execution, functional completeness, problem-solution fit, UX, learning — and any event-specific weights) plus its **gating rules** (submission format, track eligibility, sponsor-API requirements, deadlines). Evaluates every candidate against those criteria and returns a verdict with criterion-by-criterion, actionable feedback — behaving like a real judge at demo time.
9. **Sponsor Reviewer** — reviews from each sponsor's perspective: does the idea serve the sponsor's stated goals, its challenge track, and its prize criteria?
10. **Audience Reviewer** — reviews from the event audience/end-user perspective: is it demo-compelling, adoptable, and first-paint wow?
11. **Build Feasibility Reviewer (Product / Project Manager)** — assesses buildability of every candidate within the hackathon's **build window** (the time between research and demo): decomposes each idea into an MVP, estimates effort against the available hours and the team's size/skill set (from config), checks the tech stack is achievable by that team, and flags scope creep or over-ambition. Its feedback may propose MVP-scope reductions that make an idea feasible; it also feeds the MVP decomposition in the Build Handoff.
- The **Judge, Sponsor Reviewer, Audience Reviewer, and Build Feasibility Reviewer form the Reviewer Panel** — the approval body that gates the deliberation loop (FR4). The Judge carries the most weight: its rubric assessment *is* the event's scoring sheet. The panel is extensible per event (e.g., an Organizer or Mentor reviewer).
- Every researcher cites sources inline (URL, file, line) and stamps **confidence (high/medium/low)** on each claim.
- An **Orchestrator** routes work, enforces the time budget and the loop's iteration budget, enforces stage gates, and publishes live events to the control-room UI when present.

**FR3 — Ideation (divergent)**
- Generate a configurable idea pool (default 10–20) spanning safe → bold.
- Each idea card: one-line pitch · problem–solution fit · target user · primary tech approach · differentiator (vs. boilerplate/CRUD) · data leverage (which dataset, how) · gating fit (track/eligibility/sponsor-API requirements) · estimated build scope.
- Scope estimates on every idea card are sanity-checked by the Build Feasibility Reviewer before the idea enters the loop.
- Ideas must map to the problem statement **verbatim** — no adjacent-to-prompt drift.

**FR4 — Deliberation Loop (convergent, iterative)**
The decision flow is **not linear**: ideas pass through repeated rounds until the Reviewer Panel approves the outcome. This loop is the only stage that iterates.

Each round:
1. **Debate** — the Devil's Advocate critiques every surviving candidate against research findings; rebuttals allowed; every claim referenced.
2. **Refine & score** — the Synthesis & Decision Lead applies the prior round's feedback, then scores candidates on the **weighted decision model** (defaults, configurable per event):
   - Problem–Solution Fit (answers the exact prompt) — 25%
   - Feasibility within event timeframe & tech constraints — 20%
   - Innovation / Differentiation (non-CRUD, novel mechanism) — 20%
   - Stakeholder Alignment (sponsors, judges, audience) — 15%
   - Data Leverage (provided data drives the core mechanism) — 10%
   - Demo-ability (one-click, first-paint wow, mobile-safe) — 10%
3. **Reviewer assessment** — the Reviewer Panel reviews the current shortlist. Each persona returns a verdict — **Approve** or **Revise** — with specific, actionable feedback (what is weak, what must change, what is missing). The Judge's verdict is criterion-by-criterion against the event's actual rubric and gating rules; the Build Feasibility Reviewer's verdict is against the build window and team capacity, and may propose MVP-scope reductions to make a candidate feasible.
4. **Loop control** — all reviewers Approve ⇒ finalize the Top 3 and winning solution. Any Revise ⇒ the Decision Lead incorporates the feedback, refines or replaces candidates, and starts the next round. Every revision must demonstrably address the prior feedback (feedback → revision traceability).

Termination & escalation:
- Ends on **unanimous approval**, or when a configurable **iteration budget** (default: 3 rounds) is exhausted — then it escalates to a human with the Reviewer Panel's dissent log and any unfinished objections.
- The loop **converges**: each round narrows the pool or tightens scores; it never widens or churns without progress.
- Re-research is permitted only for **targeted gaps** flagged by reviewers — never a full re-run.

**FR5 — Outputs (Markdown artifacts)**
Every artifact is written as a versioned Markdown file into a configured output directory (`output/<event-slug>/…`), one file per artifact — human-readable, diffable, and ready to hand to the build team. The two headline artifacts are the build team's starting point (note: these are the *hackathon solution* spec and plan the Strategist produces, distinct from this document's design spec for the Strategist itself):

1. **`spec.md` — Solution Spec** — the winning solution, authored by the Decision Lead and finalized only on panel approval: problem statement (verbatim), target user, feature set, the differentiator, tech stack, data model, gating-fit statement, and risk notes.
2. **`implementation-plan.md` — Implementation Plan** — authored by the Build Feasibility Reviewer: MVP scope and what is deliberately cut, phases mapped to the event clock, task breakdown, definition of done, demo script, deployment steps.
3. **`executive-summary.md`** — winning solution in ≤150 words: what, for whom, why it wins, what to build first.
4. **`shortlist.md`** — Top-3 comparative matrix (idea × criterion), scores, trade-offs.
5. **`evidence-dossier.md`** — all findings with citations; sponsor/judge/audience analysis; past-winner patterns; data insights (charts where relevant).
6. **`loop-log.md`** — per round: challenges, rebuttals, eliminations, each reviewer's verdict and feedback, the revisions made, and any human interjections.
7. **`approval-sheet.md`** — final per-reviewer verdicts (Judge rubric scores, Sponsor, Audience, Build Feasibility) and any dissents carried into the decision.
8. **`decision-brief.md`** — scoring model, weights, sensitivity analysis, runner-up flip conditions.

**FR6 — Control Room UI (optional, real-time)**
The System MAY ship a lightweight web control room that streams the deliberation live. It is strictly optional: fully headless runs (CLI/agent-only) behave identically and produce identical artifacts. The UI provides:

- **Live transcript** — every persona message streams in real time (SSE/WebSocket), grouped by round, with speaker, stage, and citations.
- **Status panel** — current stage, round number, iteration budget used, remaining research time, personas active/pending.
- **Live scoring board** — the idea pool with current scores, rank changes across rounds, and reviewer verdicts as they land.
- **Human interjection** — at any point the user can post a perspective, addressed to the whole room or to a specific persona. It is injected as an authoritative **human directive**: flagged in the transcript, incorporated into the next round, and written to `loop-log.md`. The run pauses at the round boundary to accept it unless "continue without pause" is set.
- **Gate & escalation controls** — approve / pause / resume the run, and resolve escalations in-UI (e.g., when the iteration budget is exhausted, the human picks a winner or requests one more round).
- **Local-only** — the room runs locally; no remote access or third-party sharing.

### Non-Functional Requirements
- **Time-boxing**: a phase budget governor (configurable) drives stage transitions, bounds loop iterations and per-round time, and blocks research rabbit-holes.
- **Feedback traceability**: every revision maps to reviewer feedback (bidirectional: feedback → revision, revision → feedback).
- **Parallelism**: independent research roles run concurrently; debate is the only strictly serial stage.
- **Determinism & replay**: same inputs + config ⇒ same shortlist (seeded where applicable).
- **Observability**: every stage emits structured trace data (stages, roles, artifacts, citations), which also powers the control-room UI's live transcript.
- **Configurability**: weights, targets, budgets, and policy rules externalized in a per-event config file.

### Design Constraints & Guardrails
- Platform-agnostic architecture; architect recommends the orchestration framework (may align with existing multi-agent/context conventions such as a `.agents/` registry + routing rules, or propose a new one).
- Degrades gracefully on partial inputs (missing website / data).
- Respects event rules (prohibited tools, copyrighted prize content, posting policy) surfaced as configurable policy rules.
- **Human-in-the-loop at defined gates** (approve Top-3 before final pick; approve winner before build) unless a fully-autonomous mode is explicitly enabled; in UI mode these gates and any interjections are handled in the control room, and every interjection is logged and traceable.
- **Headless parity**: the control-room UI changes nothing about the decision contract — headless runs produce the same artifacts and loop behavior without it.
- **The loop must terminate**: the iteration budget caps rounds; a non-converging loop escalates to a human instead of refining forever.
- **No veto without rationale**: a reviewer cannot Revise without specific, actionable feedback; pure contrarianism is logged as a dissent note, not a blocker.
- **Anti-patterns the System must avoid**: choosing a solution that ignores provided data; "AI-wrapper-only" ideas; adjacent-to-prompt drift; over-scoping beyond the time budget; picking before sponsor/judge intel is gathered.

### Required Spec Deliverables
1. System context & architecture diagram (components, agents, data flows).
2. Agent roster: role, charter, tools, inputs/outputs per role.
3. Stage-gate workflow: stage definitions, entry/exit criteria, gate decisions, and the deliberation loop's round protocol (verdict contract, feedback schema, termination rules).
4. Data & interface contracts: input schema, idea-card schema, score-model schema, reviewer-verdict schema, human-directive schema, output-artifact schema.
5. Orchestration & concurrency model (how agents run, communicate, coordinate), the Reviewer Panel's approval protocol, and the live-event stream contract for the control room.
6. Config model: full parameter list with defaults and a per-event example (including team size/skill set for feasibility assessment).
7. Failure & degradation matrix: behavior per missing input, per tool failure.
8. Implementation plan: milestones, suggested tech stack, top risks.
9. Control-room UI design (optional component): streaming model, interjection API, gate controls, and headless-parity guarantees.

### Acceptance Criteria
The design is accepted when a build team can:
- Point the System at a real hackathon (URL + problem statement + datasets) and receive the full research package — including `spec.md` and `implementation-plan.md` — written to `output/<event-slug>/` within the time budget, sufficient for a build team to start coding with no follow-up questions.
- Trace every score and claim in the shortlist back to a citation in the dossier.
- Re-run against a second, different hackathon using config changes only.
- Force a **Revise** verdict from the Judge (e.g., a candidate that ignores the rubric's innovation criterion) and confirm the next round's revision demonstrably addresses that feedback; the run still terminates in unanimous approval or an explicit human escalation with a dissent log — never an unbounded loop.
- Launch the control-room UI during a live run, watch a debate round as it streams, interject a perspective, and confirm the next round demonstrably incorporates it and the interjection appears in `loop-log.md`.
- Run the same event twice, once headless and once with the control room, and confirm the output artifacts are identical.
- Identify, from the risk register alone, the top three things that could make the recommended solution lose — and what was done about them.
