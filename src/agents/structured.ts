// ── Structured output coercion — lenient LLM JSON → typed domain objects ──
//
// Personas return JSON of varying shapes. These helpers normalize that JSON
// into the typed domain objects the engine consumes, defaulting missing fields
// instead of crashing. A coercion that yields an empty result is treated as a
// degraded role (caller falls back to a stub).

import type {
  Confidence,
  DebateMessage,
  DeliberationRound,
  FeedbackItem,
  IdeaCard,
  PanelPersonaId,
  PersonaId,
  ResearchFinding,
  ReviewerVerdict,
  Score,
} from '../data/types.js'

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? v as Record<string, unknown> : {}
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v.trim() ? v : fallback
}

function asNumber(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Robustly normalize a persona's raw output to a list of idea cards.
 * Accepts `{ ideas: [...] }` or a bare array.
 */
export function toIdeaCards(data: unknown, startId = 1): IdeaCard[] {
  const wrap = asRecord(data)
  const arr = asArray(
    wrap.ideas ?? wrap.candidates ?? wrap.proposals ?? wrap.idea_cards ?? data,
  )
  const cards: IdeaCard[] = []

  for (const item of arr) {
    const r = asRecord(item)
    const pitch = asString(r.oneLinePitch ?? r.pitch ?? r.title ?? r.name)
    if (!pitch) continue // skip malformed entries

    cards.push({
      id: asString(r.id, `idea-${startId + cards.length}`),
      oneLinePitch: pitch,
      problemFit: asString(r.problemFit, 'Answers the prompt'),
      targetUser: asString(r.targetUser, ''),
      techApproach: asString(r.techApproach, ''),
      differentiator: asString(r.differentiator, ''),
      dataLeverage: asString(r.dataLeverage, ''),
      gatingFit: asString(r.gatingFit, ''),
      buildScope: asString(r.buildScope, ''),
    })
  }

  return cards
}

/**
 * Normalize LLM output to ResearchFinding[]. Accepts `{ findings: [...] }`
 * or a bare array.
 */
export function toFindings(data: unknown, role: PersonaId): ResearchFinding[] {
  const arr = asArray(asRecord(data).findings ?? data)
  const findings: ResearchFinding[] = []

  for (const item of arr) {
    const r = asRecord(item)
    const claim = asString(r.claim ?? r.finding ?? r.text)
    if (!claim) continue

    findings.push({
      role,
      section: asString(r.section ?? r.topic, 'general'),
      claim,
      evidence: asArray(r.evidence).map((e) => {
        const er = asRecord(e)
        const conf = asString(er.confidence ?? er.level) as Confidence
        return {
          source: asString(er.source ?? er.url ?? er.citation, ''),
          confidence: ['high', 'medium', 'low'].includes(conf) ? conf : 'medium',
          note: asString(er.note),
        }
      }),
    })
  }

  return findings
}

/**
 * Normalize LLM output to a single ReviewerVerdict.
 * Accepts `{ verdict: 'approve'|'revise', feedback: [...], rubricScores: {...} }`.
 */
export function toVerdict(data: unknown, reviewer: PanelPersonaId): ReviewerVerdict {
  const r = asRecord(data)
  const verdictRaw = asString(r.verdict ?? r.decision, '').toLowerCase()
  const verdict = verdictRaw.startsWith('approve') ? 'approve' : 'revise'

  const feedback: FeedbackItem[] = asArray(r.feedback ?? r.issues ?? r.comments)
    .map((f) => {
      const fr = asRecord(f)
      return {
        topic: asString(fr.topic ?? fr.criterion ?? 'general'),
        issue: asString(fr.issue ?? fr.problem ?? fr.what, ''),
        requiredChange: asString(fr.requiredChange ?? fr.fix ?? fr.change, ''),
        evidence: fr.evidence ? {
          source: asString(asRecord(fr.evidence).source, ''),
          confidence: asString(asRecord(fr.evidence).confidence) as Confidence,
        } : undefined,
      }
    })
    .filter((f) => f.issue !== '')

  const rubricRaw = asRecord(r.rubricScores ?? r.scores)
  const rubricScores: Record<string, number> = {}
  for (const [k, v] of Object.entries(rubricRaw)) {
    rubricScores[k] = asNumber(v)
  }

  return { reviewer, verdict, feedback, rubricScores: Object.keys(rubricScores).length ? rubricScores : undefined }
}

/**
 * Normalize LLM output to debate messages.
 * Accepts `{ debate: [...] }`, `{ messages: [...] }`, or a bare array.
 */
export function toDebateMessages(
  data: unknown,
  fallbackPersona: PersonaId,
): DeliberationRound['debate'] {
  const wrap = asRecord(data)
  const arr = asArray(
    wrap.debate ?? wrap.messages ?? wrap.critiques ?? wrap.arguments ?? wrap.comments ?? data,
  )
  const messages: DebateMessage[] = []

  for (const item of arr) {
    const r = asRecord(item)
    const text = asString(r.text ?? r.content ?? r.message ?? r.critique)
    if (!text) continue

    messages.push({
      persona: (asString(r.persona ?? r.role) || fallbackPersona) as PersonaId,
      text,
      citations: asArray(r.citations ?? r.evidence).map((c) =>
        typeof c === 'string' ? c : asString(asRecord(c).source, ''),
      ).filter(Boolean),
    })
  }

  return messages
}

const CRITERION_KEYS = [
  'problemFit', 'feasibility', 'innovation',
  'stakeholderAlignment', 'dataLeverage', 'demoAbility',
] as const

/**
 * Extract the 6 criterion values from a score-shaped object.
 * Returns null if fewer than 3 criteria are real numbers — used to reject
 * objects that merely *look* like scores (e.g. a Decision Lead summary).
 */
function extractCriteria(source: Record<string, unknown>): Score['criteria'] | null {
  const out = {} as Score['criteria']
  let real = 0

  for (const key of CRITERION_KEYS) {
    const raw = source[key] ?? source[key === 'stakeholderAlignment' ? 'stakeholder' : key]
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (Number.isFinite(n)) real++
    out[key] = Number.isFinite(n) ? n : 0
  }

  return real >= 3 ? out : null
}

/**
 * Normalize LLM output to scores. Accepts a bare array of
 * `{ ideaId, problemFit, feasibility, innovation, stakeholderAlignment, dataLeverage, demoAbility }`,
 * `{ criteria: {...} }` nested, or a map keyed by ideaId.
 *
 * When `knownIds` is provided, only scores whose ideaId matches are kept.
 * Entries without at least 3 real numeric criteria are rejected — this guards
 * against misparsing non-score JSON into all-zero scores.
 */
export function toScores(data: unknown, knownIds?: string[]): Score[] {
  const arr = asArray(asRecord(data).scores ?? data)
  const scores: Score[] = []

  if (arr.length > 0) {
    for (const item of arr) {
      const r = asRecord(item)
      const inner = asRecord(r.criteria)
      const ideaId = asString(r.ideaId ?? r.id ?? '')
      if (!ideaId) continue
      if (knownIds && !knownIds.includes(ideaId)) continue

      const source = Object.keys(inner).length > 0 ? inner : r
      const criteria = extractCriteria(source)
      if (!criteria) continue

      scores.push({ ideaId, criteria, total: asNumber(r.total) })
    }
    return scores
  }

  // Map form: { "idea-1": { problemFit: 8, ... } } — only if every value
  // is a genuine score object; otherwise reject wholesale (no garbage keys).
  const map = asRecord(data)
  const entries = Object.entries(map)
  if (entries.length === 0) return []

  const allGenuine = entries.every(([id, value]) => {
    if (knownIds && !knownIds.includes(id)) return false
    return extractCriteria(asRecord(value)) !== null
  })
  if (!allGenuine) return []

  return entries.flatMap(([ideaId, value]) => {
    const criteria = extractCriteria(asRecord(value))
    if (!criteria) return []
    return [{ ideaId, criteria, total: asNumber(asRecord(value).total) }]
  })
}
