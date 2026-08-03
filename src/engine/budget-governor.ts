// ── Budget Governor — enforces time budgets and round caps ──────────────────

import type { BudgetConfig } from '../config/types.js'

export interface BudgetState {
  researchElapsedMs: number
  roundsUsed: number
  roundStartMs: number
}

export class BudgetGovernor {
  #researchHours: number
  #maxRounds: number
  #perRoundMs: number
  #state: BudgetState
  #researchStartMs: number

  constructor(budgets?: BudgetConfig) {
    this.#researchHours = budgets?.researchHours ?? 3
    this.#maxRounds = budgets?.maxRounds ?? 3
    this.#perRoundMs = (budgets?.perRoundMinutes ?? 20) * 60_000
    this.#researchStartMs = Date.now()
    this.#state = {
      researchElapsedMs: 0,
      roundsUsed: 0,
      roundStartMs: Date.now(),
    }
  }

  /** Call when the research stage ends. Records elapsed time. */
  endResearch(): void {
    this.#state.researchElapsedMs = Date.now() - this.#researchStartMs
  }

  /** Call at the start of each deliberation round. Returns false if budget exhausted. */
  startRound(): boolean {
    this.#state.roundsUsed++
    this.#state.roundStartMs = Date.now()
    return this.#state.roundsUsed <= this.#maxRounds
  }

  /** Whether the current round has exceeded its per-round budget. */
  roundExpired(): boolean {
    return Date.now() - this.#state.roundStartMs > this.#perRoundMs
  }

  /** Whether the research stage exceeded its overall budget. */
  researchExpired(): boolean {
    return this.#state.researchElapsedMs > this.#researchHours * 3_600_000
  }

  /** How many rounds remain (0 = exhausted). */
  roundsRemaining(): number {
    return Math.max(0, this.#maxRounds - this.#state.roundsUsed)
  }

  /** Current state snapshot (for status display). */
  getState(): BudgetState {
    return { ...this.#state }
  }
}
