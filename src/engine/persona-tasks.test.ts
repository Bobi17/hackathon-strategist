// ── persona-tasks hardening tests — empty-output retry ─────────────────────
//
// The local LLM gateways intermittently return an EMPTY body on the first call.
// tryRun must retry once before degrading to a stub. We mock the runner and
// assert the retry happens and the findings still land.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { LLMResult } from '../agents/llm.js'
import type { RunResult } from '../agents/runner.js'
import type { EventConfig } from '../config/types.js'
import type { IngestedInput } from '../research/ingest.js'

vi.mock('../agents/runner.js', () => ({
  runPersonaById: vi.fn(),
}))

import { reviseIdeas, runResearch } from './persona-tasks.js'
import { runPersonaById } from '../agents/runner.js'

const mockRun = vi.mocked(runPersonaById)

const CONFIG: EventConfig = {
  slug: 't',
  name: 'Test',
  websiteUrls: [],
  problemStatements: ['p'],
  team: { size: 1, skills: [] },
  mode: 'headless',
}

const INPUT: IngestedInput = {
  siteSections: [],
  problemStatements: ['p'],
  dataFilePaths: [],
  gaps: [],
}

function llmResult(): LLMResult {
  return { content: 'x', inputTokens: 1, outputTokens: 1, model: 'm', provider: 'openai-compatible' }
}

function runResult(persona: string, raw: string, parsed?: unknown): RunResult {
  return { persona: persona as RunResult['persona'], raw, parsed, toolCalls: [], llm: llmResult() }
}

const VALID = {
  findings: [{ section: 'tracks', claim: 'AI track exists', evidence: [{ source: 'u', confidence: 'high' }] }],
}

const EMPTY_OK = { findings: [] }

beforeEach(() => mockRun.mockReset())
afterEach(() => vi.unstubAllGlobals())

describe('runResearch empty-output retry', () => {
  it('retries once on empty output and keeps the findings', async () => {
    let intelCalls = 0
    mockRun.mockImplementation((persona) => {
      if (persona === 'event-intelligence-analyst') {
        intelCalls++
        if (intelCalls === 1) return Promise.resolve(runResult(persona, ''))
        return Promise.resolve(runResult(persona, JSON.stringify(VALID), VALID))
      }
      return Promise.resolve(runResult(persona, JSON.stringify(EMPTY_OK), EMPTY_OK))
    })

    const res = await runResearch(CONFIG, INPUT)

    // First persona was called twice (empty → retry → data); others once.
    expect(intelCalls).toBe(2)
    expect(mockRun).toHaveBeenCalledTimes(5)
    expect(res.findings).toHaveLength(1)
    expect(res.findings[0]!.role).toBe('event-intelligence-analyst')
    // The other 3 personas returned empty findings → correctly flagged degraded;
    // the retried persona is NOT degraded.
    expect(res.degraded).toEqual([
      'sponsor-stakeholder-analyst',
      'past-winners-analyst',
      'data-analyst',
    ])
  })

  it('degrades after retry still returns empty', async () => {
    mockRun.mockResolvedValue(runResult('event-intelligence-analyst', ''))
    const res = await runResearch(CONFIG, INPUT)
    // Each persona called twice, both empty → all degraded, no findings.
    expect(mockRun).toHaveBeenCalledTimes(8)
    expect(res.findings).toHaveLength(0)
    expect(res.degraded.length).toBeGreaterThan(0)
  })
})

describe('reviseIdeas degradation', () => {
  const cards = [
    { id: 'idea-1', oneLinePitch: 'p1', problemFit: '', targetUser: '', techApproach: '', differentiator: '', dataLeverage: '', gatingFit: '', buildScope: '' },
    { id: 'idea-2', oneLinePitch: 'p2', problemFit: '', targetUser: '', techApproach: '', differentiator: '', dataLeverage: '', gatingFit: '', buildScope: '' },
  ]

  it('returns the candidates unchanged when the LLM is unavailable', async () => {
    // Empty raw output → tryRun retries, then returns unparsed → reviseIdeas
    // degrades to the unchanged candidates. (After mockReset(), throwing or
    // rejecting inside the mock trips vitest's unhandled-error detector, so
    // match the existing empty-output style instead.)
    mockRun.mockResolvedValue(runResult('innovation-scout', ''))
    const res = await reviseIdeas(CONFIG, cards, 'make it bigger', [], [], 'synthesis')
    expect(res).toBe(cards)
  })

  it('returns the candidates unchanged when the LLM output is unparseable', async () => {
    mockRun.mockResolvedValue(runResult('innovation-scout', 'not json'))
    const res = await reviseIdeas(CONFIG, cards, 'make it bigger', [], [], 'synthesis')
    expect(res).toBe(cards)
  })

  it('rewrites the cards but keeps stable ids when the LLM returns a revision', async () => {
    const revised = { ideas: cards.map((c) => ({ ...c, oneLinePitch: `${c.oneLinePitch} v2` })) }
    mockRun.mockResolvedValue(runResult('innovation-scout', JSON.stringify(revised), revised))
    const res = await reviseIdeas(CONFIG, cards, 'make it bigger', [], [], 'synthesis')
    expect(res).toHaveLength(2)
    expect(res.map((c) => c.id)).toEqual(['idea-1', 'idea-2'])
    expect(res[0]!.oneLinePitch).toBe('p1 v2')
  })
})
