# Hackathon Strategist — Product Spec

> **What** the Hackathon Strategist is and why it exists. The engineering design
> (**how**) lives in `IMPLEMENTATION_PLAN.md`; the agent-facing directive is
> `AGENTS.md`; the scoring sheet the Judge applies is `RUBRIC.md`. Requirements
> originate in `prompt.md` (the architect brief this spec implements).
> Concrete beats vague: an agent turns every line below into code.

## 1. Elevator Pitch

The **Hackathon Strategist** is a multi-agent research & ideation system that tells a hackathon team **what to build to win** — before anyone writes code. It ingests the event website, problem statements, and any provided data; researches sponsors, judges, audience, and past winners; generates candidate ideas; and iterates a **debate-and-refine loop** until a panel of reviewer personas — including a rubric-expert Judge and a build-feasibility PM — approves a **Top 3** and a single **winning solution**. The output is a `spec.md` + `implementation-plan.md` the build team can execute immediately, and an optional real-time **control room** where a human can watch the personas discuss and interject their perspective.

## 2. Problem & Motivation

Hackathon teams have limited hours, and the highest-leverage decision — *what* to build — is usually made in the first hour, intuitively. The result is adjacent-to-prompt drift, boilerplate CRUD, ideas that ignore the provided data, or solutions no judge or sponsor cares about. The Strategist front-loads evidence into that decision: it treats picking the solution as a **research + deliberation problem**, not a guess. It removes the "built adjacent to the prompt" failure and replaces it with a cited, defensible recommendation the build team can act on immediately.

## 3. Goals (by demo time)

- **Primary:** A headless CLI run on a real hackathon (URL + problem statement + dataset) produces the full research package — `spec.md`, `implementation-plan.md`, dossier, loop log — inside the research budget (default 3 h).
- **Secondary:** The control room opens on the same run, streams a live debate round, and a human interjection visibly lands in the next round and in `loop-log.md`.
- **Polish:** Config-only reuse across a second event; identical artifacts headless vs. with the UI.

## 4. Users & Core Scenarios

- **User:** the hackathon team lead / strategist (the same person who will build the solution).
- **Scenario A (headless):** kick off `pnpm strategist:run --config config/events/<event>.json` before kickoff → receive `output/<event-slug>/spec.md` + `implementation-plan.md` and start building immediately.
- **Scenario B (supervised):** open the control room, watch the Judge critique an idea the user disagrees with, post an interjection ("our team has no mobile skills — deprioritize the PWA"), and see the next round incorporate it.
- **Scenario C (reuse):** point the same build at a second event with only config changes; get a comparable package.

## 5. Prompt → Solution Fit **(rubric: Problem-Solution Fit)**

Map `prompt.md` (the brief) to what we build — line by line.

| prompt.md requires | What we build to answer it | Where it lives |
|---|---|---|
| "team of hackathon researchers" | 12 specialist personas + an Orchestrator | `.agents/personas/`, `src/agents/` |
| "ingest hackathon website contents, problem statements… analyze data" | Ingestion layer + parsers (html/csv/json/pdf/xlsx) + Data Analyst | `src/research/` |
| "past successes of similar hackathons" | Past-Winners Analyst persona | `.agents/personas/past-winners-analyst.md` |
| "research about the sponsors, audience" | Sponsor & Stakeholder Analyst persona | `.agents/personas/sponsor-stakeholder-analyst.md` |
| "come up with innovation ideas" | Innovation Scout + idea-card pool | `src/data/`, `src/engine/` |
| "discuss and debate" | Devil's Advocate + structured debate rounds | `src/engine/deliberation-loop.ts` |
| "shortlist top 3 / winning solution" | Weighted scoring model + final pick | `src/data/scoring.ts` |
| "loop until all stakeholders and reviewers approve" | Iterative deliberation loop + Reviewer Panel | `src/engine/deliberation-loop.ts` |
| "judge who understands gating/rubric, innovation/originality" | Judge persona (owns rubric + gating) | `.agents/personas/judge.md`, `RUBRIC.md` |
| "feasibility to build under the time limit" | Build Feasibility Reviewer persona | `.agents/personas/build-feasibility-reviewer.md` |
| "produce a spec and implementation plan as output md files" | Markdown artifact writer | `src/artifacts/`, `output/<event-slug>/` |
| "option UI to view real-time discussions and jump in" | React control room, live stream, human directives | `src/control-room/` |

## 6. The Differentiator — wired end-to-end **(rubric: Innovation, Completeness)**

The differentiator is **the iterative, consensus-gated deliberation loop** — a decision flow that is deliberately *not* a one-shot idea picker. It loops through debate → refine/score → reviewer assessment until the panel approves, escalating to a human instead of forcing a bad consensus.

- **(a) Data model:** `DeliberationRound`, `ReviewerVerdict`, `FeedbackItem`, `HumanDirective`, `LoopOutcome` are first-class typed values (`src/data/types.ts`).
- **(b) UI:** the control-room transcript, live scoring board, and interject box render the loop in real time (`src/control-room/client/`).
- **(c) Connected:** the engine publishes `LoopEvent`s → the server streams them to the UI → a human directive is accepted at a round boundary → the next round demonstrably incorporates it → the artifact writer persists the whole arc to `loop-log.md`.

A run that *only* prints a winner — without the loop, the rubric Judge, or a live transcript — is not the product.

## 7. Scope

### In (must-have)
- [ ] Headless CLI run: ingest → research (parallel) → ideate → deliberation loop → artifacts.
- [ ] 12 personas with charters, tools, and evidence/citation discipline.
- [ ] Weighted scoring model (25/20/20/15/10/10) with sensitivity reporting.
- [ ] Reviewer Panel (Judge, Sponsor, Audience, Build Feasibility) with Approve/Revise verdicts and feedback → revision traceability.
- [ ] Loop termination: unanimous approval or escalation with a dissent log (max-rounds budget).
- [ ] Markdown artifacts: `spec.md`, `implementation-plan.md`, `executive-summary.md`, `shortlist.md`, `evidence-dossier.md`, `loop-log.md`, `approval-sheet.md`, `decision-brief.md`.
- [ ] Control room (optional): live transcript, status, scoring board, interject, gate controls; headless parity.

### Out (explicitly deferred — state it so agents don't build it)
- Multi-event portfolio planning / reusing intel across events.
- Automating the *build* phase (this is decision-only).
- Persistent state across runs beyond the output directory (no DB).
- Fully-autonomous prize-money optimization or anything against event rules.

## 8. Constraints & Assumptions

- **Stack:** TypeScript (Node ≥ 22, pnpm, strict), Anthropic SDK (Claude) for personas, plain-TS orchestration engine, React 19 + Vite 8 + Tailwind v4 for the control room, `ws`/SSE for streaming, vitest + oxlint. Base scaffold comes from `launchpad-ts`.
- **Time:** buildable in a weekend (~16–24 h of agent effort across the phases in `IMPLEMENTATION_PLAN.md`).
- **Team:** implementation agents + a human operator who holds an `ANTHROPIC_API_KEY`.
- **Env vars:** `ANTHROPIC_API_KEY` (required), `CONTROL_ROOM_PORT` (default 8787), `OUTPUT_DIR` (default `output/`). See `.env.example`.
- **Data:** website content is fetched at run time; datasets are user-provided files in `config/events/<event>/` or an absolute path.
- **No global installs:** all dependencies local to the package (pnpm-only), mirroring launchpad-ts rules.

## 9. Success Criteria (demo-checkable) **(rubric: Completeness)**

The run's acceptance criteria (from `prompt.md`) translated into demo checks:

- [ ] Point at a real hackathon (URL + problem statement + dataset) → full package in `output/<event-slug>/` within the research budget, sufficient to start coding with no follow-up questions.
- [ ] Every score and claim in `shortlist.md` traces to a citation in `evidence-dossier.md`.
- [ ] Same build re-runs on a second, different event using config changes only.
- [ ] Force a Judge **Revise** on a weak candidate → next round demonstrably addresses it; run terminates in unanimous approval or an explicit human escalation with a dissent log — never an unbounded loop.
- [ ] Control room: watch a round live, interject a perspective, confirm the next round incorporates it and the interjection appears in `loop-log.md`.
- [ ] Headless run and control-room run on the same event produce identical artifacts.
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green; no console errors.

**What actually demos (30 seconds):** `pnpm strategist:run --config config/events/example.json` → show `output/example/spec.md` + `implementation-plan.md` → reopen the same run in the control room and post an interjection → show `loop-log.md` picking it up.

**What is aspirational:** live judge-award simulation against a real rubric PDF, and an "anti-idea" round where the Devil's Advocate proposes the worst ideas to pre-empt traps.

## 10. Open Questions / Risks

- **LLM cost/latency:** a full run is many model calls. Mitigate with per-persona `model` overrides, parallelism, and a research budget governor. (Highest risk to the 3-hour budget.)
- **Web ingestion fragility:** JS-rendered event sites may resist `cheerio`; a Playwright fallback is a Phase-5 hardening task.
- **Loop convergence:** a Revise verdict that cannot be satisfied could churn. The max-rounds governor + human escalation covers this, but convergence quality is only provable on real events.
- **Citation grounding:** agents must not fabricate sources. The evidence rule (`Evidence`, confidence) is enforced in the runner, not just asked for.
