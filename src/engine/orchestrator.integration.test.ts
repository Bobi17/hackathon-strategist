// ── Orchestrator integration test — full pipeline on deterministic stubs ──
//
// Runs the entire Orchestrator end-to-end with NO LLM provider configured, so
// every persona degrades to its deterministic stub. This proves the pipeline
// (ingest → research → synthesize → ideate → loop → gates → artifacts) holds
// together without a gateway and produces a complete, valid artifact set.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { EventConfig } from '../config/types.js'
import { Orchestrator } from './orchestrator.js'
import { ControlRoomServer } from '../control-room/server.js'
import { DirectiveBroker } from '../control-room/broker.js'

// Project-local scratch (gitignored) so tests never write outside the repo root.
const SCRATCH_ROOT = join(process.cwd(), '.test-tmp')

const ARTIFACTS = [
  'spec.md',
  'implementation-plan.md',
  'executive-summary.md',
  'shortlist.md',
  'evidence-dossier.md',
  'loop-log.md',
  'approval-sheet.md',
  'decision-brief.md',
]

function makeConfig(dir: string): EventConfig {
  return {
    slug: 'itest',
    name: 'Integration Test Event',
    websiteUrls: [],
    problemStatements: ['Build an AI-powered solution for supply-chain visibility.'],
    dataFiles: [],
    sponsors: [{ name: 'TestCo', track: 'AI', prize: '$1k' }],
    pastWinnersUrls: [],
    team: { size: 3, skills: ['typescript', 'react'] },
    mode: 'headless',
    budgets: { researchHours: 0, maxRounds: 1, continueWithoutPause: true },
    gates: { approveTop3: true, pickWinner: true },
    outputDir: dir,
  }
}

describe('Orchestrator end-to-end (stubs, no LLM)', () => {
  let dir: string

  beforeAll(async () => {
    // Force "no provider" so every persona call degrades to a stub. Also
    // neutralise any gateway env leaked from the shell.
    vi.stubEnv('LLM_API_KEY', '')
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    await mkdir(SCRATCH_ROOT, { recursive: true })
    dir = await mkdtemp(join(SCRATCH_ROOT, 'strategist-itest-'))
  })

  afterAll(async () => {
    vi.unstubAllEnvs()
    await rm(dir, { recursive: true, force: true })
  })

  it('produces a valid outcome and writes all 8 artifacts', async () => {
    const orch = new Orchestrator(makeConfig(dir))
    const { outcome, artifactPaths } = await orch.run()

    // Reviewers degrade to "revise" → iteration budget (1 round) exhausted.
    expect(outcome.status).toBe('escalated')
    expect(outcome.rounds.length).toBe(1)
    expect(outcome.top3.length).toBeGreaterThan(0)
    expect(outcome.winner.oneLinePitch.length).toBeGreaterThan(0)

    // Every artifact path exists on disk.
    expect(artifactPaths).toHaveLength(ARTIFACTS.length)
    for (const name of ARTIFACTS) {
      expect(artifactPaths).toContain(join(dir, 'itest', name))
    }
  })

  it('writes artifacts with real structure (headers, scores, rounds)', async () => {
    const read = (name: string) => readFile(join(dir, 'itest', name), 'utf-8')

    const executive = await read('executive-summary.md')
    expect(executive).toMatch(/^# Executive Summary/m)
    expect(executive.length).toBeGreaterThan(50) // header + winner pitch

    const loopLog = await read('loop-log.md')
    expect(loopLog).toMatch(/Round \d/)

    const shortlist = await read('shortlist.md')
    expect(shortlist).toMatch(/Top 3/)
    expect(shortlist).toMatch(/\|.*\*\*.*\*\*.*\|/) // a score row with a total

    const decision = await read('decision-brief.md')
    expect(decision).toMatch(/problemFit|Problem|Feasibility/i)

    // No stray files beyond cache + artifacts.
    const files = await readdir(join(dir, 'itest'))
    const md = files.filter((f) => f.endsWith('.md')).sort()
    expect(md).toEqual([...ARTIFACTS].sort())
  })

  it('auto-picks the top-ranked idea through the pick-winner gate (server present)', async () => {
    const cfg = { ...makeConfig(dir), slug: 'pick', outputDir: dir }
    const broker = new DirectiveBroker()
    const server = new ControlRoomServer({ broker, port: 0, gateTimeoutMs: 0 })
    server.autoResolveGates = true // headless → auto-resolve all gates including pickWinner
    await server.start()

    const orch = new Orchestrator(cfg, { server, broker })
    const { outcome, artifactPaths } = await orch.run()
    await server.close()

    expect(outcome.top3.length).toBeGreaterThan(0)
    // Winner must be the top-ranked idea from the loop's final scores.
    const lastScores = [...(outcome.rounds[outcome.rounds.length - 1]?.scores ?? [])]
    const topScored = lastScores.sort((a, b) => b.total - a.total)[0]
    expect(outcome.winner.id).toBe(topScored!.ideaId)

    // The pick-winner gate should also write artifacts (no crashes).
    expect(artifactPaths.length).toBeGreaterThan(0)
  })
})
