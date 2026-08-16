// ── Orchestrator — the run controller ──────────────────────────────────────

import { join } from 'node:path'
import type { EventConfig } from '../config/types.js'
import type { LoopOutcome, IdeaCard } from '../data/types.js'
import { StageMachine } from './stage-machine.js'
import { BudgetGovernor } from './budget-governor.js'
import { runDeliberationLoop } from './deliberation-loop.js'
import { writeArtifacts } from '../artifacts/writer.js'
import { ingestEvent } from '../research/ingest.js'
import { createBrowserSession, type BrowserSession } from '../research/browser.js'
import type { ToolContext } from '../agents/tools.js'
import {
  runResearch,
  synthesizeFindings,
  ideate,
  reviseIdeas,
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

    const auto = this.#config.mode !== 'ui' || this.#config.budgets?.continueWithoutPause === true
    if (this.#server) this.#server.autoResolveGates = auto

    // Browser session: lazy (only the dynamic import runs eagerly; the actual
    // Chromium launch happens on first `render` or `openForLogin`). Created
    // when interactive (login handoff) or when `useBrowser` is forced.
    let session: BrowserSession | null = null
    if (!auto || this.#config.useBrowser) {
      const profileDir = join(
        this.#config.outputDir ?? 'output',
        this.#config.slug,
        '.cache',
        'browser-profile',
      )
      session = await createBrowserSession(profileDir, { headless: auto })
    }

    // ToolContext: lets personas (webFetch) reuse the logged-in session for
    // login-gated / SPA pages discovered mid-run.
    const toolContext: ToolContext = {
      fetch: (url) =>
        import('../research/fetch.js').then((m) =>
          m.fetchWithEscalation(
            this.#config,
            url,
            { session, server: this.#server, auto },
          ),
        ).then((r) => (r.source !== 'failed' && r.content ? r.content : null)),
    }

    try {
      // ── Ingest ────────────────────────────────────────────────────────
      this.#stages.advance() // → ingest
      console.log('📡  Ingesting event inputs...')
      const input = await ingestEvent(this.#config, { session, server: this.#server, auto })
      if (input.gaps.length > 0) {
        console.log(`   ⚠  Gaps flagged: ${input.gaps.join('; ')}`)
      }

      // ── Research (personas 2–5, parallel) ─────────────────────────────
      this.#stages.advance() // → research
      console.log('🔍  Running research personas in parallel...')
      const research = await runResearch(this.#config, input, toolContext)
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

      // Reusable across the main loop and any pick-winner refinement iterations.
      const callbacks = {
        debate: makeDebateCallback(this.#config, research.findings, synthesis),
        score: makeScoreCallback(this.#config, research.findings),
        review: makeReviewCallback(this.#config, research.findings, weightsText, this.#broker),
        collectDirectives: () => this.#broker?.takeConsumed() ?? [],
      }

      let { outcome, allRounds } = await runDeliberationLoop(this.#config, this.#budget, candidates, callbacks)

      console.log(`   ✅  Loop ended: ${outcome.status} after ${outcome.rounds.length} round(s)`)
      console.log(`   🏆  Winner: ${outcome.winner.oneLinePitch}`)

      // ── Gates — human-in-the-loop checkpoints (ui mode only) ───────────
      // Headless / continue-without-pause resolves instantly (still logged).
      if (this.#server) {
        this.#server.autoResolveGates = auto

        if (this.#config.gates?.approveTop3 !== false) {
          await this.#server.requestGate('approveTop3', { top3: outcome.top3 })
        }
        if (this.#config.gates?.pickWinner !== false) {
          // Pick one of the Top 3, or send feedback to rewrite the cards and
          // re-deliberate. Headless / continue-without-pause auto-picks the
          // top-ranked idea. Bounded by budgets.refineRounds.
          const maxRefines = this.#config.budgets?.refineRounds ?? 3
          let top3 = outcome.top3
          let refined = 0

          while (refined < maxRefines) {
            const res = await this.#server.requestPickWinner(top3)
            if (res.kind === 'picked') {
              const picked = top3.find((c) => c.id === res.ideaId)
              if (picked) outcome.winner = picked
              break
            }
            if (res.kind === 'escalated') break

            refined++
            this.#broker?.add('all', `[Winner pick feedback] ${res.message}`)
            const revised = await reviseIdeas(
              this.#config,
              top3,
              res.message,
              outcome.rounds[outcome.rounds.length - 1]?.verdicts ?? [],
              research.findings,
              synthesis,
            )

            // One fresh round on the revised cards, continuing round numbering so
            // the merged history reads as one continuous deliberation.
            const next = await runDeliberationLoop(
              this.#config,
              new BudgetGovernor({ ...this.#config.budgets, maxRounds: 1 }),
              revised,
              callbacks,
              { startRound: allRounds.length, priorRounds: allRounds },
            )
            allRounds = next.allRounds
            outcome = next.outcome
            top3 = outcome.top3

            globalBus.emit({
              kind: 'message',
              round: allRounds.length,
              persona: 'orchestrator',
              text: `Feedback applied — Top 3 refined (iteration ${refined}): ${res.message}`,
              citations: [],
            })
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
    } finally {
      await session?.close()
    }
  }
}
