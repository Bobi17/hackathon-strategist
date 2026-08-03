// ── Orchestrator — the run controller ──────────────────────────────────────

import type { EventConfig } from '../config/types.js'
import type { LoopOutcome, IdeaCard } from '../data/types.js'
import { StageMachine } from './stage-machine.js'
import { BudgetGovernor } from './budget-governor.js'
import { runDeliberationLoop } from './deliberation-loop.js'
import { writeArtifacts } from '../artifacts/writer.js'
import { ingestEvent } from '../research/ingest.js'
import {
  runResearch,
  synthesizeFindings,
  ideate,
  makeDebateCallback,
  makeScoreCallback,
  makeReviewCallback,
} from './persona-tasks.js'
import { mergeWeights } from '../data/scoring.js'
import { globalBus } from './event-bus.js'
import type { ControlRoomServer } from '../control-room/server.js'
import type { DirectiveBroker } from '../control-room/broker.js'

export interface RunResult {
  outcome: LoopOutcome
  artifactPaths: string[]
}

export interface OrchestratorOptions {
  /** Live control room. When present, events stream to it and gates can hold. */
  server?: ControlRoomServer
  /** Broker for human interjections (usually owned by the server). */
  broker?: DirectiveBroker
}

/**
 * The Orchestrator drives the full Strategist run:
 * ingest → research → synthesize → ideate → loop → gates → finalize → artifacts.
 *
 * Research, ideation, debate, scoring, and review run real personas via the
 * LLM (persona-tasks.ts), degrading to deterministic stubs when the LLM is
 * unavailable. Every stage emits events on the global bus, which the optional
 * control-room server streams to a browser.
 */
export class Orchestrator {
  #config: EventConfig
  #stages: StageMachine
  #budget: BudgetGovernor
  #server?: ControlRoomServer
  #broker?: DirectiveBroker

  constructor(config: EventConfig, opts: OrchestratorOptions = {}) {
    this.#config = config
    this.#stages = new StageMachine()
    this.#budget = new BudgetGovernor(config.budgets)
    this.#server = opts.server
    this.#broker = opts.broker ?? opts.server?.broker
  }

  async run(): Promise<RunResult> {
    this.#server?.broadcastRun('starting', this.#config.name)

    // ── Ingest ────────────────────────────────────────────────────────
    this.#stages.advance() // → ingest
    console.log('📡  Ingesting event inputs...')
    const input = await ingestEvent(this.#config)
    if (input.gaps.length > 0) {
      console.log(`   ⚠  Gaps flagged: ${input.gaps.join('; ')}`)
    }

    // ── Research (personas 2–5, parallel) ─────────────────────────────
    this.#stages.advance() // → research
    console.log('🔍  Running research personas in parallel...')
    const research = await runResearch(this.#config, input)
    if (research.degraded.length > 0) {
      console.log(`   ⚠  Degraded personas: ${research.degraded.join(', ')}`)
    }
    console.log(`   ✓  ${research.findings.length} research findings collected`)

    // ── Synthesize (decision-lead) ────────────────────────────────────
    this.#stages.advance() // → synthesize
    console.log('📝  Synthesizing findings...')
    const synthesis = await synthesizeFindings(this.#config, research.findings)

    // ── Ideate (innovation-scout) ─────────────────────────────────────
    this.#stages.advance() // → ideate
    console.log('💡  Generating candidate ideas...')
    const { ideas, degraded: ideateDegraded } = await ideate(
      this.#config,
      synthesis,
      research.findings,
    )
    if (ideateDegraded) console.log('   ⚠  Ideation degraded to fallback ideas')
    console.log(`   ✓  ${ideas.length} candidate ideas`)
    const candidates: IdeaCard[] = ideas

    // ── Deliberation Loop ─────────────────────────────────────────────
    this.#stages.advance() // → loop
    console.log('⚖️  Entering deliberation loop...')
    this.#budget.endResearch()

    const weights = mergeWeights(this.#config.weights)
    const weightsText = [
      `problemFit=${weights.problemFit}`, `feasibility=${weights.feasibility}`,
      `innovation=${weights.innovation}`, `stakeholderAlignment=${weights.stakeholderAlignment}`,
      `dataLeverage=${weights.dataLeverage}`, `demoAbility=${weights.demoAbility}`,
    ].join(', ')

    const { outcome, allRounds } = await runDeliberationLoop(
      this.#config,
      this.#budget,
      candidates,
      {
        debate: makeDebateCallback(this.#config, research.findings, synthesis),
        score: makeScoreCallback(this.#config, research.findings),
        review: makeReviewCallback(this.#config, research.findings, weightsText, this.#broker),
        collectDirectives: () => this.#broker?.takeConsumed() ?? [],
      },
    )

    console.log(`   ✅  Loop ended: ${outcome.status} after ${outcome.rounds.length} round(s)`)
    console.log(`   🏆  Winner: ${outcome.winner.oneLinePitch}`)

    // ── Gates — human-in-the-loop checkpoints (ui mode only) ───────────
    // Headless / continue-without-pause resolves instantly (still logged).
    if (this.#server) {
      const auto = this.#config.mode !== 'ui' || this.#config.budgets?.continueWithoutPause === true
      this.#server.autoResolveGates = auto

      if (this.#config.gates?.approveTop3 !== false) {
        await this.#server.requestGate('approveTop3', { top3: outcome.top3 })
      }
      if (this.#config.gates?.approveWinner !== false) {
        const winnerApproved = await this.#server.requestGate('approveWinner', { winner: outcome.winner })
        if (!winnerApproved && this.#config.mode === 'ui') {
          outcome.dissentLog.push({
            reviewer: 'judge',
            objection: 'Human vetoed the recommended winner at the approve-winner gate.',
          })
          outcome.status = 'escalated'
        }
      }
    }

    globalBus.emit({
      kind: 'message',
      round: outcome.rounds.length,
      persona: 'orchestrator',
      text: `Winner selected: **${outcome.winner.oneLinePitch}** (${outcome.status} after ${outcome.rounds.length} round(s))`,
      citations: [],
    })

    // ── Finalize ──────────────────────────────────────────────────────
    this.#stages.advance() // → finalize
    console.log('🎯  Finalizing recommendation...')

    // ── Artifacts ─────────────────────────────────────────────────────
    this.#stages.advance() // → artifacts
    console.log('📄  Writing markdown artifacts...')
    const evidenceDump = [
      research.evidenceText,
      '',
      '---',
      '',
      '## Synthesis',
      synthesis,
    ].join('\n')

    const artifactPaths = await writeArtifacts(
      this.#config,
      outcome,
      allRounds,
      evidenceDump,
    )
    console.log(`   Wrote ${artifactPaths.length} files to ${this.#config.outputDir ?? 'output'}/${this.#config.slug}/`)

    this.#server?.broadcastRun('complete', `${outcome.status} — winner: ${outcome.winner.oneLinePitch}`)

    return { outcome, artifactPaths }
  }
}
