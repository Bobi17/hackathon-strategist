import { describe, it, expect } from 'vitest'
import { scoreIdea, rank, mergeWeights, roundMadeProgress, sensitivityAnalysis } from './scoring.js'
import type { ScoreWeights, DeliberationRound } from './types.js'

describe('scoreIdea', () => {
  it('computes weighted total correctly', () => {
    const w: ScoreWeights = { problemFit: 0.5, feasibility: 0.5, innovation: 0, stakeholderAlignment: 0, dataLeverage: 0, demoAbility: 0 }
    const s = scoreIdea('a', { problemFit: 8, feasibility: 6, innovation: 0, stakeholderAlignment: 0, dataLeverage: 0, demoAbility: 0 }, w)
    expect(s.total).toBe(7) // 8*0.5 + 6*0.5 = 7
    expect(s.ideaId).toBe('a')
  })

  it('rounds to 3 decimal places', () => {
    const w: ScoreWeights = { problemFit: 0.33, feasibility: 0.33, innovation: 0.34, stakeholderAlignment: 0, dataLeverage: 0, demoAbility: 0 }
    const s = scoreIdea('b', { problemFit: 7, feasibility: 7, innovation: 7, stakeholderAlignment: 0, dataLeverage: 0, demoAbility: 0 }, w)
    expect(s.total).toBeCloseTo(7, 2)
  })
})

describe('rank', () => {
  it('sorts by total descending, breaking ties by id', () => {
    const c = { problemFit: 5, feasibility: 5, innovation: 5, stakeholderAlignment: 0, dataLeverage: 0, demoAbility: 0 }
    const scores = [
      { ideaId: 'b', criteria: c, total: 5 },
      { ideaId: 'a', criteria: { ...c, problemFit: 8, feasibility: 8, innovation: 8 }, total: 8 },
      { ideaId: 'c', criteria: { ...c, problemFit: 8, feasibility: 8, innovation: 8 }, total: 8 },
    ]
    const r = rank(scores)
    expect(r[0]!.ideaId).toBe('a') // same total, 'a' < 'c'
    expect(r[0]!.rank).toBe(1)
    expect(r[1]!.ideaId).toBe('c')
    expect(r[1]!.rank).toBe(2)
    expect(r[2]!.ideaId).toBe('b')
    expect(r[2]!.rank).toBe(3)
  })
})

describe('mergeWeights', () => {
  it('overrides defaults', () => {
    const w = mergeWeights({ problemFit: 0.5 })
    expect(w.problemFit).toBe(0.5)
    expect(w.feasibility).toBe(0.20) // default
  })

  it('returns defaults when no overrides', () => {
    const w = mergeWeights()
    expect(w.problemFit).toBe(0.25)
  })
})

describe('roundMadeProgress', () => {
  const base = (n: number, revisions: number, scoreTotal: number): DeliberationRound => ({
    number: n,
    candidates: [],
    scores: [{ ideaId: 'x', criteria: { problemFit: 0, feasibility: 0, innovation: 0, stakeholderAlignment: 0, dataLeverage: 0, demoAbility: 0 }, total: scoreTotal }],
    debate: [],
    verdicts: [],
    directivesApplied: [],
    revisions: Array.from({ length: revisions }, (_, i) => ({ feedbackId: `f${i}`, whatChanged: 'changed' })),
  })

  it('always progresses on first round', () => {
    expect(roundMadeProgress(base(1, 0, 5))).toBe(true)
  })

  it('progresses when revisions were made', () => {
    expect(roundMadeProgress(base(2, 1, 5), base(1, 0, 5))).toBe(true)
  })

  it('progresses when scores moved', () => {
    expect(roundMadeProgress(base(2, 0, 7), base(1, 0, 5))).toBe(true)
  })

  it('detects non-convergence', () => {
    expect(roundMadeProgress(base(2, 0, 5), base(1, 0, 5))).toBe(false)
  })
})

describe('sensitivityAnalysis', () => {
  const weights = mergeWeights()
  const c = (pf: number, fe: number, inn: number, sa: number, dl: number, da: number) =>
    ({ problemFit: pf, feasibility: fe, innovation: inn, stakeholderAlignment: sa, dataLeverage: dl, demoAbility: da })

  it('reports the criteria the winner depends on (drop → rank falls)', () => {
    // A wins on problemFit alone; B is stronger everywhere else.
    const scores = rank([
      scoreIdea('a', c(10, 8, 8, 8, 8, 8), weights),
      scoreIdea('b', c(0, 10, 10, 10, 10, 10), weights),
    ])
    expect(scores[0]!.ideaId).toBe('a')

    const sens = sensitivityAnalysis(scores, weights, 'a')
    expect(sens.problemFit).toBeGreaterThan(0) // remove problemFit → A drops
    expect(sens.innovation).toBe(0)            // removing other criteria doesn't move A
  })

  it('is all zeros for a single candidate', () => {
    const scores = rank([scoreIdea('a', c(5, 5, 5, 5, 5, 5), weights)])
    const sens = sensitivityAnalysis(scores, weights, 'a')
    expect(Object.values(sens)).toEqual([0, 0, 0, 0, 0, 0])
  })
})
