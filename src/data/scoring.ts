// ── Scoring engine — weighted model + sensitivity analysis ─────────────────

import type {
  Score,
  ScoreWeights,
  DeliberationRound,
} from './types.js'
import { DEFAULT_WEIGHTS } from './types.js'

/**
 * Merge user-provided weight overrides on top of defaults.
 */
export function mergeWeights(overrides?: Partial<ScoreWeights>): ScoreWeights {
  return { ...DEFAULT_WEIGHTS, ...overrides }
}

/**
 * Score a single idea. `rawScores` maps each criterion to a 0–10 score.
 */
export function scoreIdea(
  ideaId: string,
  rawScores: Record<keyof ScoreWeights, number>,
  weights: ScoreWeights,
): Score {
  const total = (Object.keys(weights) as (keyof ScoreWeights)[]).reduce(
    (sum, key) => sum + rawScores[key] * weights[key],
    0,
  )
  return { ideaId, criteria: rawScores, total: round(total) }
}

/**
 * Rank scores by total (descending), breaking ties by ideaId.
 * Returns a new array (does not mutate).
 */
export function rank(scores: Score[]): Score[] {
  const sorted = [...scores].sort((a, b) =>
    b.total !== a.total ? b.total - a.total : a.ideaId.localeCompare(b.ideaId),
  )
  return sorted.map((s, i) => ({ ...s, rank: i + 1 }))
}

/**
 * Sensitivity: for each criterion, drop its weight to 0 and re-rank.
 * Returns a map of criterion → how many positions the winner moved.
 * 0 = criterion didn't matter; positive = winner would rank lower without it
 * (the criterion is load-bearing for the win).
 */
export function sensitivityAnalysis(
  allScores: Score[],
  weights: ScoreWeights,
  winnerId: string,
): Record<keyof ScoreWeights, number> {
  const winnerPos = allScores.findIndex((s) => s.ideaId === winnerId)
  const result = {} as Record<keyof ScoreWeights, number>

  for (const crit of Object.keys(weights) as (keyof ScoreWeights)[]) {
    const perturbed = { ...weights }
    perturbed[crit] = 0
    // Renormalize remaining weights
    const sum = (Object.keys(perturbed) as (keyof ScoreWeights)[]).reduce(
      (s, k) => s + perturbed[k],
      0,
    )
    if (sum > 0) {
      for (const k of Object.keys(perturbed) as (keyof ScoreWeights)[]) {
        perturbed[k] /= sum
      }
    }

    const rescored = rank(
      allScores.map((s) => ({
        ...s,
        total: (Object.keys(perturbed) as (keyof ScoreWeights)[]).reduce(
          (acc, k) => acc + s.criteria[k] * perturbed[k],
          0,
        ),
      })),
    )

    const newPos = rescored.findIndex((s) => s.ideaId === winnerId)
    result[crit] = newPos - winnerPos // positive = winner drops
  }

  return result
}

/**
 * Check whether a DeliberationRound made progress vs the prior round.
 * "No progress" = no feedback addressed and no score movement → non-convergence.
 */
export function roundMadeProgress(
  current: DeliberationRound,
  prior?: DeliberationRound,
): boolean {
  if (!prior) return true
  // Feedback addressed?
  if (current.revisions.length > 0) return true
  // Score movement?
  for (const s of current.scores) {
    const prev = prior.scores.find((p) => p.ideaId === s.ideaId)
    if (!prev || Math.abs(prev.total - s.total) > 0.001) return true
  }
  return false
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}
