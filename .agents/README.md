# .agents — Hackathon Strategist context system (lean)

This directory holds **only Strategist-specific** machinery. The **shared vendor
catalog** — 400+ personas, 160+ skills, spec-kit templates, rules, MCP, tools —
lives in the `launchpad-ts` template at
`/data/hackathons/templates/launchpad-ts/.agents/`. **Do not copy that catalog
here.** Reference it when a task needs a generic skill (e.g. `claude-api`,
`webapp-testing`, `frontend-design`, `skill-creator`).

## What lives here

| Layer | Contents |
|---|---|
| `personas/` | **Runtime persona definitions** for the Strategist: 12 files (orchestration/research/creation/decision/reviewer). The LLM runner loads each file's frontmatter + body as that persona's system prompt. |
| `rules/` | Standing directives that always apply: `engineering` (stack), `orchestration` (loop/stages), `evidence` (citation + confidence). |
| `skills/` | Strategist-specific procedures: `web-ingest`, `data-analysis`, `debate-protocol`. |
| `registry.json` | Machine-readable graph: personas, skills, routing table (task → context). |

## How personas work

Each `personas/<category>/<slug>.md` follows the launchpad persona format:

```
---
name: <Name>
description: <one-line — used for routing/selection>
color: <accent>
emoji: <emoji>
vibe: <one-liner>
---
# <Name> Agent Personality
... identity, mission, critical rules ...
```

The runner (`src/agents/runner.ts`) reads `description` for routing and the
rest for the system prompt, then injects role-scoped tools per
`IMPLEMENTATION_PLAN.md` §1 (agent roster).

## Routing

`registry.json` maps tasks → personas/skills/rules, mirroring the launchpad
convention. Rules always apply. When in doubt, read `IMPLEMENTATION_PLAN.md`
§1–§2 — it is the detailed contract for how personas are used.
