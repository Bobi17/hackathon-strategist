// ── Stage Machine — drives the Strategist through its stages ───────────────

import type { Stage } from '../data/types.js'
import { globalBus } from './event-bus.js'

const STAGE_ORDER: Stage[] = ['ingest', 'research', 'synthesize', 'ideate', 'loop', 'finalize', 'artifacts']

export class StageMachine {
  #current: number = -1

  /** Transition to the next stage. Emits a stage event on the bus. */
  advance(): Stage {
    this.#current++
    if (this.#current >= STAGE_ORDER.length) {
      throw new Error('StageMachine: already at final stage — cannot advance further.')
    }
    const stage = STAGE_ORDER[this.#current]!
    globalBus.emit({ kind: 'stage', stage, at: Date.now() })
    return stage
  }

  /** Current stage (or null if not started). */
  current(): Stage | null {
    return this.#current >= 0 ? STAGE_ORDER[this.#current]! : null
  }

  /** Whether the machine is at or past the given stage. */
  isPast(stage: Stage): boolean {
    const idx = STAGE_ORDER.indexOf(stage)
    return this.#current >= idx
  }

  /** Whether the machine has finished all stages. */
  isDone(): boolean {
    return this.#current >= STAGE_ORDER.length - 1
  }

  /** Remaining stages from current. */
  remaining(): Stage[] {
    return STAGE_ORDER.slice(this.#current + 1)
  }

  /** Reset (for tests). */
  reset(): void {
    this.#current = -1
  }
}
