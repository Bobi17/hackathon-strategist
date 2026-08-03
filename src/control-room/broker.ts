// ── Directive Broker — routes human interjections to the reviewer panel ────
//
// A human in the control room can interject during the deliberation loop. The
// interjection becomes a HumanDirective; the broker hands it to the relevant
// reviewer persona(s) on the next review round, injected into their context.
//
// Semantics:
//   - A directive targeting a specific reviewer goes to exactly that persona.
//   - A directive targeting "all" is broadcast to EVERY reviewer in the round.
//   - Directives are shown (handed out) but not removed until the round ends,
//     so concurrent reviewers each see the full set. `finishRound()` archives
//     exactly what was shown this round; `takeConsumed()` drains it for the
//     round record and loop-log.

import type { HumanDirective, PanelPersonaId } from '../data/types.js'

export class DirectiveBroker {
  #pending: HumanDirective[] = []
  #consumed: HumanDirective[] = []
  #shownThisRound = new Set<string>()
  #seq = 0

  /** Register a human interjection. Returns the stamped directive. */
  add(persona: PanelPersonaId | 'all', message: string): HumanDirective {
    const directive: HumanDirective = {
      id: `d-${++this.#seq}`,
      at: Date.now(),
      from: 'human',
      target: persona,
      message,
    }
    this.#pending.push(directive)
    return directive
  }

  /** Directives a persona should see next round (targeted + all broadcasts). */
  pendingFor(persona: PanelPersonaId): HumanDirective[] {
    return this.#pending.filter(
      (d) => d.target === 'all' || d.target === persona,
    )
  }

  /** True if any directive is awaiting a round. */
  hasPending(): boolean {
    return this.#pending.length > 0
  }

  /**
   * Hand the directives for one reviewer persona. Does NOT remove them — the
   * review callback runs all personas concurrently, and an "all" directive
   * must reach every one of them. Shown ids are recorded so `finishRound()`
   * archives an exact set.
   */
  consume(persona: PanelPersonaId): HumanDirective[] {
    const mine = this.pendingFor(persona)
    for (const d of mine) this.#shownThisRound.add(d.id)
    return mine
  }

  /**
   * Called once at the end of a review round: archive exactly the directives
   * that were handed out this round and clear them from pending.
   */
  finishRound(): HumanDirective[] {
    const shown = this.#pending.filter((d) => this.#shownThisRound.has(d.id))
    this.#pending = this.#pending.filter((d) => !this.#shownThisRound.has(d.id))
    this.#consumed.push(...shown)
    this.#shownThisRound.clear()
    return shown
  }

  /** Drain the directives archived since the last call (once per round). */
  takeConsumed(): HumanDirective[] {
    const out = this.#consumed
    this.#consumed = []
    return out
  }

  /** All directives ever registered (for UI replay / artifact writer). */
  all(): HumanDirective[] {
    return [...this.#pending, ...this.#consumed]
  }

  /** Reset (for tests). */
  reset(): void {
    this.#pending = []
    this.#consumed = []
    this.#shownThisRound.clear()
    this.#seq = 0
  }
}
