// ── Persona display metadata (shared constants — kept out of components so
// fast-refresh only re-renders the component file) ──────────────────────────

import type { PersonaId } from '../../data/types'

const PERSONA_META: Record<string, { emoji: string; label: string; chip: string }> = {
  orchestrator: { emoji: '🎛️', label: 'Orchestrator', chip: 'bg-zinc-700 text-zinc-100' },
  'event-intelligence-analyst': { emoji: '🕵️', label: 'Event Intel', chip: 'bg-sky-900 text-sky-200' },
  'sponsor-stakeholder-analyst': { emoji: '🏢', label: 'Sponsor & Stakeholder', chip: 'bg-amber-900 text-amber-200' },
  'past-winners-analyst': { emoji: '🏆', label: 'Past Winners', chip: 'bg-violet-900 text-violet-200' },
  'data-analyst': { emoji: '📊', label: 'Data Analyst', chip: 'bg-emerald-900 text-emerald-200' },
  'innovation-scout': { emoji: '💡', label: 'Innovation Scout', chip: 'bg-fuchsia-900 text-fuchsia-200' },
  'devils-advocate': { emoji: '😈', label: "Devil's Advocate", chip: 'bg-red-900 text-red-200' },
  'decision-lead': { emoji: '⚖️', label: 'Decision Lead', chip: 'bg-blue-900 text-blue-200' },
  judge: { emoji: '🧑‍⚖️', label: 'Judge', chip: 'bg-green-900 text-green-200' },
  'sponsor-reviewer': { emoji: '🏅', label: 'Sponsor Reviewer', chip: 'bg-yellow-900 text-yellow-200' },
  'audience-reviewer': { emoji: '👥', label: 'Audience Reviewer', chip: 'bg-pink-900 text-pink-200' },
  'build-feasibility-reviewer': { emoji: '🔧', label: 'Feasibility', chip: 'bg-orange-900 text-orange-200' },
}

export function personaMeta(persona: PersonaId): { emoji: string; label: string; chip: string } {
  return PERSONA_META[persona] ?? { emoji: '🤖', label: persona, chip: 'bg-zinc-800 text-zinc-200' }
}
