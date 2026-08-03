---
name: debate-protocol
description: Run a structured deliberation round — critique, rebuttal, weighted scoring, reviewer Approve/Revise verdicts, feedback-to-revision traceability, and termination. Use inside the deliberation loop.
---

# Debate Protocol — the deliberation loop's round

Procedure for the loop stage. One round per invocation; the engine owns the
loop control.

## Round sequence
1. **Debate** — Devil's Advocate critiques each surviving candidate against the
   research findings. Rebuttals are allowed. Every claim cited.
2. **Refine & score** — Decision Lead applies the prior round's feedback and any
   pending human directives, then scores each candidate 0–10 per criterion on
   the weighted model (`RUBRIC.md`). `total = Σ(scoreᵢ × weightᵢ)`, normalized.
3. **Reviewer assessment** — each panel persona returns a verdict:
   - `approve` — every criterion ≥ 6/10 and no gating failure (Judge), no
     blocking concerns (others).
   - `revise` — with `FeedbackItem[]`: each item names the **topic, the issue,
     and the required change** (plus evidence). "No veto without rationale."
   - The Judge always emits rubric scores, even on `approve`.
4. **Loop control** (engine, not persona):
   - All `approve` ⇒ return `approved`.
   - Any `revise` ⇒ collect feedback, start round N+1.
   - Rounds exhausted (`maxRounds`) ⇒ return `escalated` with the dissent log.
   - No progress (no feedback addressed, no scores moved) ⇒ `escalated`.

## Feedback → revision traceability
Every round's revision lists the feedback items it addresses, by id. A round
that ignores prior feedback is a non-convergence signal.

## Human directives
Apply pending directives (targeted to a persona or the room) in step 2 before
scoring. Record each as applied in the round.

## Output
`DeliberationRound` (candidates, scores, debate, verdicts, directivesApplied,
revisions) → consumed by the orchestrator and persisted to `loop-log.md`.
