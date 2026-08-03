// ── Deliberation Loop — the iterative debate→score→review→approve engine ──

import type {
  DeliberationRound,
  HumanDirective,
  IdeaCard,
  LoopOutcome,
  PanelPersonaId,
  ReviewerVerdict,
} from '../data/types.js'
import { globalBus } from './event-bus.js'
import { rank, scoreIdea, mergeWeights, roundMadeProgress } from '../data/scoring.js'
import type { EventConfig } from '../config/types.js'
import type { BudgetGovernor } from './budget-governor.js'

/**
 * Run the deliberation loop. This function owns the iterative structure:
 * debate → score → review → loop-control until approved or budget exhausted.
 *
 * External systems provide the debate/score/review implementations via
 * callbacks — this module owns the loop logic, not the LLM calls.
 */
export async function runDeliberationLoop(
  config: EventConfig,
  budget: BudgetGovernor,
  initialCandidates: IdeaCard[],
  callbacks: {
    /** Run debate rounds for all surviving candidates. */
    debate: (candidates: IdeaCard[], roundNumber: number) => Promise<DeliberationRound['debate']>
    /** Score candidates and return scores. */
    score: (candidates: IdeaCard[], roundNumber: number) => Promise<DeliberationRound['scores']>
    /** Run the reviewer panel and return verdicts. */
    review: (candidates: IdeaCard[], scores: DeliberationRound['scores'], roundNumber: number) => Promise<ReviewerVerdict[]>
    /**
     * Drain the human directives consumed during this round (interjections).
     * Called once per round to stamp `directivesApplied` on the record.
     */
    collectDirectives?: () => HumanDirective[]
  },
): Promise<{ outcome: LoopOutcome; allRounds: DeliberationRound[] }> {
  const weights = mergeWeights(config.weights)
  const allRounds: DeliberationRound[] = []
  const candidates: IdeaCard[] = [...initialCandidates]

  let approved = false
  let roundNumber = 0
  let approvals: Record<PanelPersonaId, boolean> = {} as Record<PanelPersonaId, boolean>
  let dissentLog: LoopOutcome['dissentLog'] = []

  while (!approved) {
    roundNumber++

    // Budget check
    if (!budget.startRound()) {
      break // max rounds exhausted
    }

    globalBus.emit({ kind: 'round', number: roundNumber, action: 'start' })

    // 1. Debate
    const debate = await callbacks.debate(candidates, roundNumber)

    // 2. Score
    const rawScores = await callbacks.score(candidates, roundNumber)
    const scores = rank(rawScores.map((s) => {
      const merged = mergeWeights(weights)
      return scoreIdea(s.ideaId, s.criteria, merged)
    }))

    // 3. Review
    const verdicts = await callbacks.review(candidates, scores, roundNumber)

    // Check approvals
    approvals = {} as Record<PanelPersonaId, boolean>
    dissentLog = []
    let allApproved = true

    for (const v of verdicts) {
      approvals[v.reviewer] = v.verdict === 'approve'
      if (v.verdict === 'revise') allApproved = false
      // Record dissents (non-blocking concerns on approve)
      if (v.verdict === 'approve') {
        for (const f of v.feedback) {
          dissentLog.push({ reviewer: v.reviewer, objection: `[note] ${f.topic}: ${f.issue}` })
        }
      }
    }

    const round: DeliberationRound = {
      number: roundNumber,
      candidates: [...candidates],
      scores,
      debate,
      verdicts,
      directivesApplied: callbacks.collectDirectives?.() ?? [],
      revisions: allApproved ? [] : verdicts
        .filter((v) => v.verdict === 'revise')
        .flatMap((v) => v.feedback.map((f) => ({
          feedbackId: `${v.reviewer}:${f.topic}`,
          whatChanged: f.requiredChange,
        }))),
    }

    allRounds.push(round)

    globalBus.emit({ kind: 'round', number: roundNumber, action: 'end' })
    globalBus.emit({ kind: 'score', round: roundNumber, scores })
    for (const v of verdicts) globalBus.emit({ kind: 'verdict', round: roundNumber, verdict: v })

    // Non-convergence check
    if (allRounds.length > 1 && !roundMadeProgress(round, allRounds[allRounds.length - 2]!)) {
      break // escalate — no progress made
    }

    if (allApproved) {
      approved = true
    }
  }

  // Pick Top 3 and winner from the last round's scores — ordered by rank, not
  // by the original candidates array order.
  const lastScores = allRounds[allRounds.length - 1]?.scores ?? []
  const sorted = lastScores.slice().sort((a, b) => b.total - a.total)
  const top3 = sorted.slice(0, 3)
    .map((s) => candidates.find((c) => c.id === s.ideaId))
    .filter(Boolean) as IdeaCard[]
  const winner = top3[0] ?? candidates[0]!

  const outcome: LoopOutcome = {
    status: approved ? 'approved' : 'escalated',
    rounds: allRounds,
    top3,
    winner,
    approvals: approvals as Record<PanelPersonaId, boolean>,
    dissentLog,
  }

  return { outcome, allRounds }
}
