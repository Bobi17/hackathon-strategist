import { describe, it, expect } from 'vitest'
import {
  toIdeaCards,
  toFindings,
  toVerdict,
  toDebateMessages,
  toScores,
} from './structured.js'
import { extractJSON } from './llm.js'

describe('toIdeaCards', () => {
  it('parses a bare array', () => {
    const cards = toIdeaCards([
      { oneLinePitch: 'Idea A', problemFit: 'Fits', targetUser: 'Users' },
      { oneLinePitch: 'Idea B' },
    ])
    expect(cards).toHaveLength(2)
    expect(cards[0]!.oneLinePitch).toBe('Idea A')
    expect(cards[0]!.id).toBe('idea-1') // auto-id
    expect(cards[0]!.problemFit).toBe('Fits')
    expect(cards[1]!.dataLeverage).toBe('') // missing → default
  })

  it('parses { ideas: [...] } and aliases', () => {
    const cards = toIdeaCards({ ideas: [{ title: 'Alt name', pitch: 'Pitch' }] })
    expect(cards[0]!.oneLinePitch).toBe('Pitch') // pitch takes precedence
  })

  it('skips malformed entries', () => {
    const cards = toIdeaCards([{ notAPitch: 123 }, { oneLinePitch: 'Good' }])
    expect(cards).toHaveLength(1)
  })
})

describe('toFindings', () => {
  it('normalizes findings with evidence', () => {
    const findings = toFindings({
      findings: [
        {
          section: 'tracks',
          claim: 'There is an AI track',
          evidence: [{ source: 'https://example.com', confidence: 'high' }],
        },
      ],
    }, 'event-intelligence-analyst')
    expect(findings).toHaveLength(1)
    expect(findings[0]!.role).toBe('event-intelligence-analyst')
    expect(findings[0]!.evidence[0]!.confidence).toBe('high')
  })

  it('defaults confidence to medium', () => {
    const findings = toFindings({ findings: [{ claim: 'x', evidence: [{ source: 'u' }] }] }, 'judge')
    expect(findings[0]!.evidence[0]!.confidence).toBe('medium')
  })
})

describe('toVerdict', () => {
  it('parses approve verdict', () => {
    const v = toVerdict({ verdict: 'APPROVE', rubricScores: { problemFit: 8 } }, 'judge')
    expect(v.verdict).toBe('approve')
    expect(v.rubricScores).toEqual({ problemFit: 8 })
  })

  it('parses revise verdict with feedback', () => {
    const v = toVerdict({
      verdict: 'revise',
      feedback: [{ topic: 'scope', issue: 'too big', requiredChange: 'cut X' }],
    }, 'build-feasibility-reviewer')
    expect(v.verdict).toBe('revise')
    expect(v.feedback[0]!.topic).toBe('scope')
    expect(v.reviewer).toBe('build-feasibility-reviewer')
  })

  it('defaults unknown verdicts to revise', () => {
    const v = toVerdict({ verdict: 'maybe' }, 'judge')
    expect(v.verdict).toBe('revise')
  })
})

describe('toDebateMessages', () => {
  it('parses messages array', () => {
    const msgs = toDebateMessages({
      debate: [{ persona: 'devils-advocate', text: 'Weak differentiator', citations: ['s1'] }],
    }, 'devils-advocate')
    expect(msgs).toHaveLength(1)
    expect(msgs[0]!.citations).toEqual(['s1'])
  })

  it('falls back to default persona', () => {
    const msgs = toDebateMessages([{ text: 'just a critique' }], 'devils-advocate')
    expect(msgs[0]!.persona).toBe('devils-advocate')
  })
})

describe('toScores', () => {
  it('parses array of scores', () => {
    const scores = toScores({
      scores: [
        { ideaId: 'idea-1', problemFit: 8, feasibility: 7, innovation: 6, stakeholderAlignment: 5, dataLeverage: 4, demoAbility: 3 },
      ],
    })
    expect(scores).toHaveLength(1)
    expect(scores[0]!.criteria.problemFit).toBe(8)
    expect(scores[0]!.criteria.demoAbility).toBe(3)
  })

  it('parses map form keyed by ideaId', () => {
    const scores = toScores({
      'idea-2': { problemFit: 9, feasibility: 8, innovation: 7, stakeholderAlignment: 6, dataLeverage: 5, demoAbility: 4 },
    })
    expect(scores[0]!.ideaId).toBe('idea-2')
    expect(scores[0]!.criteria.innovation).toBe(7)
  })

  it('rejects non-score summary objects (no garbage all-zero scores)', () => {
    const scores = toScores({
      confidence: 'high',
      decision: 'approve',
      findings: '...',
      next_action: 'build',
      winner: 'idea-1',
      top3: ['idea-1', 'idea-2'],
    })
    expect(scores).toEqual([])
  })

  it('rejects entries with too few real criteria', () => {
    const scores = toScores({ scores: [{ ideaId: 'idea-1', problemFit: 8 }] })
    expect(scores).toEqual([])
  })

  it('filters to known idea ids when provided', () => {
    const scores = toScores({
      scores: [
        { ideaId: 'idea-1', problemFit: 8, feasibility: 8, innovation: 8, stakeholderAlignment: 8, dataLeverage: 8, demoAbility: 8 },
        { ideaId: 'ghost', problemFit: 9, feasibility: 9, innovation: 9, stakeholderAlignment: 9, dataLeverage: 9, demoAbility: 9 },
      ],
    }, ['idea-1'])
    expect(scores).toHaveLength(1)
    expect(scores[0]!.ideaId).toBe('idea-1')
  })
})

describe('extractJSON robustness', () => {
  it('salvages truncated JSON (model stopped mid-string)', () => {
    // 3 complete ideas + a partial 4th cut inside techApproach
    const truncated = '{"ideas":[{"oneLinePitch":"Idea A","techApproach":"X"},{"oneLinePitch":"Idea B","techApproach":"Y"},{"oneLinePitch":"Idea C","techApproach":"Z"},{"oneLinePitch":"Idea D","techApproach"'
    const parsed = extractJSON(truncated) as { ideas: { oneLinePitch: string }[] }
    expect(parsed.ideas).toHaveLength(3)
    expect(parsed.ideas[2]!.oneLinePitch).toBe('Idea C')
  })

  it('salvages JSON with unescaped newlines inside strings', () => {
    const broken = '{"findings":[{"claim":"line one\nline two"}]} trailing prose'
    const parsed = extractJSON(broken) as { findings: { claim: string }[] }
    expect(parsed.findings[0]!.claim).toContain('line two')
  })
})
