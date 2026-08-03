# Rule: Engineering Standards

Standing directive for all code in this repo. Always applies.

## Stack
- TypeScript, strict mode, Node ≥ 22, pnpm, ESM. Base scaffold comes from the
  `launchpad-ts` template; keep its Vite 8 / Tailwind v4 / React 19 conventions
  for the control room.
- **pnpm only** for dependency operations. No global installs, ever.

## Contracts first
- The data contracts in `IMPLEMENTATION_PLAN.md` §3 are law. New domain types
  belong in `src/data/types.ts`; changing a contract requires updating the
  artifact templates and tests that consume it.
- `src/App`-style composition: `src/main.ts` (headless CLI) and `src/server.ts`
  (control room) are thin composition roots over `src/engine/`.

## Behavior
- **Headless-first:** the CLI run is the product; the control room is a view on
  the same event stream. Never put decision logic in the UI.
- **Termination over heroics:** the deliberation loop must terminate — approve
  or escalate. Guard against unbounded refinement.
- **Evidence over opinion:** fabricated citations are a correctness bug
  (see `evidence.md`).
- Tests are required for: loop termination, scoring + sensitivity, artifact
  schema, config validation.

## Quality gates
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` must be green before
  any handoff. No console errors.
- Commit small and green; update `HANDOFF.md` at every boundary.
