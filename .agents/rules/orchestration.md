# Rule: Orchestration — Stages, Loop, Gates

Standing directive for the engine. Always applies.

## Stage machine
- Stages run in order: `ingest → research → synthesize → ideate →
  [deliberation loop] → finalize → artifacts`. Only the loop iterates.
- Each stage has entry/exit criteria (IMPLEMENTATION_PLAN.md §2). A stage that
  cannot meet its exit criteria degrades gracefully and flags the gap — it
  never silently produces an empty output.
- The **budget governor** converts `budgets` into hard timeboxes. When a box is
  exceeded, stop collecting input, flag the gap, and move on.

## Deliberation loop (round protocol)
Per round: **debate → refine & score → reviewer assessment → loop control.**
1. Debate: Devil's Advocate critiques survivors; rebuttals cited.
2. Refine & score: Decision Lead applies prior feedback + pending human
   directives, then scores on the weighted model.
3. Reviewer assessment: the panel (Judge, Sponsor, Audience, Build Feasibility)
   returns Approve/Revise with actionable feedback.
4. Loop control: unanimous Approve ⇒ finalize. Any Revise ⇒ next round with
   **feedback → revision traceability** (each revision lists the feedback it
   addresses).

## Termination & escalation
- End on unanimous approval, or when `budgets.maxRounds` is exhausted.
- On exhaustion, escalate to the human with the dissent log. Never force a
  fake consensus and never refine forever.
- **Non-convergence:** a round that makes no progress (no feedback addressed,
  no scores moved) escalates immediately — do not burn the remaining rounds.

## Gates & human directives
- Enforce configured human gates (`approveTop3`, `approveWinner`) by pausing at
  the boundary; headless mode auto-approves unless `mode: "ui"`.
- Accept human directives only at round boundaries (or immediately when
  `continueWithoutPause`). Inject them into the Decision Lead's next-round
  context and log them to `loop-log.md` verbatim.
- Every gate resolution and directive is part of the event stream — nothing
  human happens off-record.
