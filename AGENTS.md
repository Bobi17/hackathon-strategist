# Hackathon Strategist — Master Directive & System Prompt

Single source of truth for any agent (Claude Code, Cursor, Copilot, Codex, …)
working in this repo. Read `HANDOFF.md` before starting; update it before ending.

## 0. What this project is

We are building the **Hackathon Strategist**: a multi-agent research & ideation
system that picks a hackathon team's **winning solution before any code is
written**. Requirements: `prompt.md` (the brief). What: `spec.md`. How:
`IMPLEMENTATION_PLAN.md`. Scoring sheet: `RUBRIC.md`.

**Context layers (lean):** this repo's `.agents/` carries only Strategist-specific
machinery — the 12 runtime personas (`.agents/personas/`), standing rules
(`.agents/rules/`), and a few Strategist skills (`.agents/skills/`). The shared
vendor catalog of skills/specs/personas lives in the **`launchpad-ts`
template** (`/data/hackathons/templates/launchpad-ts/.agents/`) — reference it,
**never copy the whole list**. The runtime personas double as the spec for
`src/agents/`: the runner loads each file's frontmatter + body as the system
prompt.

## 1. Core Principles & Execution

- Speed and stability over over-engineering. This is a decision engine — the
  loop must terminate, artifacts must render.
- Adhere strictly to TypeScript types and the contracts in `IMPLEMENTATION_PLAN.md` §3.
- Never introduce breaking changes without `pnpm typecheck` and `pnpm build` passing.
- **Headless-first:** the CLI run is the product; the control room is a view on
  the same event stream. No UI ⇒ identical artifacts.
- **Evidence over opinion:** every claim a persona makes carries a citation and
  a confidence stamp. Fabricated sources are a correctness bug.

## 2. Package Management & Environment Rules

- **Exclusive tool:** `pnpm` (`pnpm install`, `pnpm add <pkg>`, `pnpm run build`).
- **Strictly prohibited:** `npm install -g`, `pnpm add -g`, any global flags.
- Node ≥ 22 (see `.nvmrc`); commit `pnpm-lock.yaml`; frozen installs in CI/deploy.
- Env: `ANTHROPIC_API_KEY` is required for persona runs. Copy `.env.example` →
  `.env.local`; never commit real secrets.

## 3. Multi-Agent Handoff Protocol

- **Starting:** read `HANDOFF.md` first. **Ending:** update it — refresh the
  front-matter and append to the entry log.
- **Ownership rule (parallel safety):** you own every file you create until you
  write a handoff entry. Never edit another agent's active file without first
  claiming it in `HANDOFF.md`. Shared files (`package.json`, `pnpm-lock.yaml`,
  `HANDOFF.md`, `AGENTS.md`, `.agents/registry.json`) require a claim before editing.
- Commit small and commit often — `git log` is the coordination layer.
- Scratch work goes in `.agent-logs/`; never commit that directory.

## 4. Styling Standards (control room only)

- Tailwind CSS v4 (CSS-first — no `tailwind.config.js`), React 19, Vite 8.
- Dark-mode-first: `.dark` on `<html>`, deep slate/zinc surfaces, single
  high-contrast accent (cyan-400). Consistent with the `launchpad-ts` base.

## 5. The Decision Rubric — build the engine to it

`RUBRIC.md` is the scoring sheet the **Judge persona applies**. Read it before
Phase 3 and re-check at every phase boundary. The engine must surface, not
hide, the weighted model: scores, sensitivity, and reviewer verdicts are
first-class artifacts (`decision-brief.md`, `approval-sheet.md`).

## 6. Definition of Done

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` clean; no console errors.
- `pnpm strategist:run --config config/events/example.json` writes all 8 artifacts;
  acceptance criteria in `spec.md` §9 pass.
- Control-room run is artifact-identical to the headless run.
- `HANDOFF.md` updated; no stray files in `output/` or `.agent-logs/`.
