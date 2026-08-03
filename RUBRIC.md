# Hackathon Strategist — Decision Rubric (Judge's Scoring Sheet)

> **AGENTS:** this is the scoring sheet the **Judge persona** applies to every
> candidate idea in the deliberation loop. It is **active instruction**, not
> reference material — read it before Phase 3 and re-check it at every phase
> boundary. The engine must make these scores, weights, and verdicts *visible*
> in `decision-brief.md` and `approval-sheet.md`, never hidden.
>
> Weights are defaults; a per-event `EventConfig.weights` override replaces
> them (the judge reads the config, not this file, at run time).

## The weighted decision model (defaults)

| Criterion | Weight | The Judge looks for | Where the evidence comes from |
|---|---|---|---|
| Problem–Solution Fit | 25% | Answers the exact prompt, verbatim — not adjacent to it | idea card `problemFit`, prompt-fit table |
| Feasibility in build window | 20% | A real team can ship the MVP in the event's build window | Build Feasibility Reviewer assessment |
| Innovation / Differentiation | 20% | Non-CRUD, novel mechanism, unusual integration — a real differentiator | Devil's Advocate debate, Judge's own read |
| Stakeholder Alignment | 15% | Serves sponsors' goals/tracks, judges' criteria, and the audience | Sponsor Reviewer, Audience Reviewer |
| Data Leverage | 10% | Provided data drives the *core mechanism*, not a decorative chart | Data Analyst leverage map |
| Demo-ability | 10% | One-click reach, first-paint wow, mobile-safe | Audience Reviewer |

Scores are 0–10 per criterion; `total = Σ(scoreᵢ × weightᵢ)`. Ranks come from
normalized totals.

## Judge instructions (applied per round)

1. **Score criterion-by-criterion** with a one-line justification each; cite
   evidence where possible. No holistic "gut score".
2. **Gate-check first:** a candidate that fails the event's gating rules
   (submission format, track eligibility, sponsor-API requirement, deadline)
   is `revise` regardless of scores.
3. **Verdict contract:** `Approve` only if every criterion is ≥ 6/10 and no
   gating failure. Otherwise `Revise` with `FeedbackItem[]` — each item must be
   specific and actionable ("what must change", not "doesn't fit").
4. **Carry dissents:** a non-blocking concern is recorded as a dissent note in
   `approval-sheet.md`, not silently dropped.
5. **The Judge's weight is highest** on the panel: rubric scores are the
   event's scoring sheet, so they are always emitted even when the verdict is
   `approve`.

## Loop-control rules for reviewers

- Any panel persona returning `revise` triggers the next round.
- **No veto without rationale:** a `revise` with no actionable feedback is a
  dissent note, not a blocker.
- The loop must **terminate**: unanimous approval, or `maxRounds` exhausted →
  escalate to the human with the dissent log. Never refine forever.

## Anti-patterns the Judge actively rejects

- A "differentiator" that exists only as a data file or diagram, not wired
  input → logic → output.
- A solution that ignores provided data.
- An AI-wrapper-only idea with no novel mechanism.
- Adjacent-to-prompt drift — the spec maps to a prompt line, or it fails fit.
- Over-scoped ambition the team cannot demo in the build window.
