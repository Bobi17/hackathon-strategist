// ── Idea Pool — structured storage for candidate ideas ─────────────────────

import type { IdeaCard } from './types.js'

export class IdeaPool {
  #ideas: Map<string, IdeaCard> = new Map()

  add(idea: IdeaCard): void {
    this.#ideas.set(idea.id, idea)
  }

  getAll(): IdeaCard[] {
    return [...this.#ideas.values()]
  }

  getById(id: string): IdeaCard | undefined {
    return this.#ideas.get(id)
  }

  remove(id: string): boolean {
    return this.#ideas.delete(id)
  }

  size(): number {
    return this.#ideas.size
  }

  /** Replace all ideas at once (after refinement). */
  replaceAll(ideas: IdeaCard[]): void {
    this.#ideas.clear()
    for (const idea of ideas) this.#ideas.set(idea.id, idea)
  }

  /** Get a snapshot for scoring (lightweight copy). */
  snapshot(): IdeaCard[] {
    return this.getAll()
  }
}
