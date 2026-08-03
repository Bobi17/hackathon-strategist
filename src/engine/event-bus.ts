// ── Event Bus — the single source of truth for the run ─────────────────────
// Every persona message, score, verdict, and gate resolution flows through
// here. Events power both `loop-log.md` and the control-room WS/SSE stream.

import type { LoopEvent, StreamEvent } from '../data/types.js'

type Listener = (evt: StreamEvent) => void

export class EventBus {
  #events: StreamEvent[] = []
  #seq = 0
  #listeners: Set<Listener> = new Set()

  /** Emit an event. Assigns a sequence number and timestamp. */
  emit(event: LoopEvent): StreamEvent {
    const seq = ++this.#seq
    const entry: StreamEvent = { seq, ts: Date.now(), event }
    this.#events.push(entry)
    for (const fn of this.#listeners) fn(entry)
    return entry
  }

  /** Subscribe to live events (control-room stream). */
  subscribe(fn: Listener): () => void {
    this.#listeners.add(fn)
    return () => { this.#listeners.delete(fn) }
  }

  /** Get all events emitted so far (for artifact writer). */
  getAll(): StreamEvent[] {
    return [...this.#events]
  }

  /** Get only the events matching a kind filter. */
  filterKind(kind: LoopEvent['kind']): StreamEvent[] {
    return this.#events.filter((e) => e.event.kind === kind)
  }

  /** Replay all past events to a new listener (for late-joining control room). */
  replayTo(fn: Listener): void {
    for (const e of this.#events) fn(e)
  }

  /**
   * Reset the transcript (for tests and UI re-launches). Keeps listeners so
   * live control-room sockets survive a fresh run.
   */
  reset(): void {
    this.#events = []
    this.#seq = 0
  }
}

/** Singleton for the run — one bus per orchestrator instance. */
export const globalBus = new EventBus()
