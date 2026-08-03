// ── DirectiveBroker unit tests — human interjection lifecycle ──────────────

import { describe, it, expect } from 'vitest'
import { DirectiveBroker } from './broker.js'

describe('DirectiveBroker', () => {
  it('routes directives to their target persona (and "all")', () => {
    const b = new DirectiveBroker()
    const all = b.add('all', 'Be bold')
    const judge = b.add('judge', 'Prize-fit first')
    expect(b.pendingFor('judge')).toEqual([all, judge])
    expect(b.pendingFor('sponsor-reviewer')).toEqual([all])
    expect(b.pendingFor('audience-reviewer')).toEqual([all])
  })

  it('broadcasts "all" directives to every reviewer in a round', () => {
    const b = new DirectiveBroker()
    b.add('all', 'Demo must work offline')
    b.add('judge', 'Prize-fit first')

    // Concurrent consumption by the whole panel — everyone sees the "all" one.
    const judge = b.consume('judge')
    const sponsor = b.consume('sponsor-reviewer')
    const audience = b.consume('audience-reviewer')
    expect(judge.map((d) => d.message)).toContain('Demo must work offline')
    expect(sponsor.map((d) => d.message)).toContain('Demo must work offline')
    expect(audience.map((d) => d.message)).toContain('Demo must work offline')
    expect(judge.map((d) => d.message)).toContain('Prize-fit first')
    expect(sponsor.map((d) => d.message)).not.toContain('Prize-fit first')
  })

  it('archives exactly what was shown when the round ends', () => {
    const b = new DirectiveBroker()
    b.add('all', 'A')
    b.add('judge', 'B')
    b.add('sponsor-reviewer', 'C')

    b.consume('judge') // sees A + B
    b.consume('sponsor-reviewer') // sees A + C

    // A directive added mid-round but never shown stays pending.
    b.add('audience-reviewer', 'late')

    const archived = b.finishRound()
    expect(archived.map((d) => d.message).sort()).toEqual(['A', 'B', 'C'])
    expect(b.pendingFor('audience-reviewer').map((d) => d.message)).toEqual(['late'])

    // The round record drains the archive exactly once.
    expect(b.takeConsumed()).toHaveLength(3)
    expect(b.takeConsumed()).toHaveLength(0)
  })

  it('leaves unconsumed directives pending', () => {
    const b = new DirectiveBroker()
    b.add('judge', 'B')
    b.consume('audience-reviewer') // shows nothing to audience
    b.finishRound()
    expect(b.pendingFor('judge')).toHaveLength(1)
  })

  it('assigns unique ids and timestamps', () => {
    const b = new DirectiveBroker()
    const d1 = b.add('judge', 'x')
    const d2 = b.add('judge', 'y')
    expect(d1.id).not.toBe(d2.id)
    expect(d1.from).toBe('human')
    expect(d1.at).toBeGreaterThan(0)
  })

  it('all() returns everything ever registered', () => {
    const b = new DirectiveBroker()
    b.add('judge', 'pending')
    b.consume('judge')
    b.finishRound()
    b.add('sponsor-reviewer', 'later')
    expect(b.all()).toHaveLength(2)
  })
})
