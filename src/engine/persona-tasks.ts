// ── Persona tasks — LLM-wired research / ideate / debate / score / review ──
//
// Every function in here runs real personas via runPersonaById, then coerces
// their JSON into typed domain objects. If the LLM is unavailable (no provider
// configured), a call fails, or parsing yields nothing, the function degrades
// gracefully to a deterministic stub and flags it — never crashes the run.

import { runPersonaById } from '../agents/runner.js'
import type { ToolContext } from '../agents/tools.js'
import { toDebateMessages, toFindings, toIdeaCards, toScores, toVerdict } from '../agents/structured.js'
import { globalBus } from './event-bus.js'
import type { DirectiveBroker } from '../control-room/broker.js'
import type { EventConfig } from '../config/types.js'
import type { IngestedInput } from '../research/ingest.js'
import type {
  DeliberationRound,
  IdeaCard,
  PanelPersonaId,
  PersonaId,
  ResearchFinding,
  ReviewerVerdict,
} from '../data/types.js'

// ── Helpers ────────────────────────────────────────────────────────────────

/** Truncate a context section to keep token budgets bounded. */
function section(label: string, text: string, maxLen = 8_000): string {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return ''
  const body = trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}…[truncated]` : trimmed
  return `## ${label}\n${body}`
}

function modelFor(config: EventConfig, persona: PersonaId): string | undefined {
  return config.model?.[persona]
}

async function tryRun(
  config: EventConfig,
  persona: PersonaId,
  context: string,
  opts?: { tools?: boolean; maxTokens?: number; toolContext?: ToolContext },
): Promise<{ raw: string; parsed?: unknown } | null> {
  // One retry on empty output: the local gateways intermittently return an
  // empty body on the first call. A blank response is never legitimate, so
  // retry once before falling back to the deterministic stub.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await runPersonaById(persona, context, {
        model: modelFor(config, persona),
        maxToolRounds: 2,
        tools: opts?.tools ?? false,
        maxTokens: opts?.maxTokens,
        toolContext: opts?.toolContext,
      })
      if (process.env.DEBUG_LLM === '1') {
        // Dump raw output so shape mismatches are diagnosable.
        console.warn(`   🐛 [DEBUG] ${persona} raw (${result.raw.length} chars):\n${result.raw.slice(0, 3000)}`)
      }
      if (result.raw.trim() === '' && attempt === 0) {
        console.warn(`   ⚠  Persona ${persona} returned empty output — retrying once`)
        continue
      }
      return { raw: result.raw, parsed: result.parsed }
    } catch (err) {
      console.warn(`   ⚠  Persona ${persona} failed (degrading): ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }
  return null
}

/** Emit a persona's output onto the event bus (powers the transcript + WS stream). */
function emitMessage(persona: PersonaId, text: string, citations: string[] = [], round = 0): void {
  const t = (text ?? '').trim()
  if (!t) return
  globalBus.emit({ kind: 'message', round, persona, text: t.slice(0, 4_000), citations })
}

// ── Research (personas 2–5, parallel) ──────────────────────────────────────

export interface ResearchResult {
  findings: ResearchFinding[]
  evidenceText: string
  degraded: string[]   // personas that fell back to stub
}

const RESEARCH_PERSONAS: { persona: PersonaId; prompt: (input: IngestedInput, config: EventConfig) => string }[] = [
  {
    persona: 'event-intelligence-analyst',
    prompt: (input) => [
      'Analyze the hackathon event website and extract the facts that determine how to win:',
      'format (24h/48h, in-person/remote), duration, tracks, tech requirements,',
      'submission rules, deadlines, and any gating constraints.',
      'Return JSON: { "findings": [{ "section": string, "claim": string, "evidence": [{ "source": string, "confidence": "high"|"medium"|"low", "note"?: string }] }] }',
      '',
      section('Event website', input.siteSections.map((s) => `${s.url}\n${s.content}`).join('\n\n')),
    ].join('\n\n'),
  },
  {
    persona: 'sponsor-stakeholder-analyst',
    prompt: (input, config) => [
      'Research the sponsors, judges, and audience of this hackathon.',
      'For each sponsor: industry, stated priorities, challenge track, prize.',
      'For judges (if named): affiliation and interests. For the audience: who is in the room.',
      'Return JSON: { "findings": [{ "section": string, "claim": string, "evidence": [...] }] }',
      '',
      section('Sponsors (config)', JSON.stringify(config.sponsors ?? [], null, 2)),
      section('Event website', input.siteSections.map((s) => `${s.url}\n${s.content}`).join('\n\n')),
    ].join('\n\n'),
  },
  {
    persona: 'past-winners-analyst',
    prompt: (input, config) => [
      'Analyze what won this or similar events and WHY. Extract patterns in:',
      'domain, tech stack, production quality, and demo strategy. Cite sources.',
      'Return JSON: { "findings": [{ "section": string, "claim": string, "evidence": [...] }] }',
      '',
      section('Past winners', input.siteSections.filter((s) => config.pastWinnersUrls?.includes(s.url)).map((s) => `${s.url}\n${s.content}`).join('\n\n')),
      section('Event website', input.siteSections.map((s) => `${s.url}\n${s.content}`).join('\n\n')),
    ].join('\n\n'),
  },
  {
    persona: 'data-analyst',
    prompt: (input) => [
      'Profile the provided datasets and map what solution classes they enable or preclude.',
      'For each dataset: schema, size, quality, distributions, and 3-5 decision-relevant signals.',
      'Return JSON: { "findings": [{ "section": string, "claim": string, "evidence": [...] }] }',
      '',
      section('Data files', input.dataFilePaths.length
        ? input.dataFilePaths.join('\n')
        : 'No datasets were provided for this event. Note this and return empty findings.'),
      section('Problem statements', input.problemStatements.join('\n\n')),
    ].join('\n\n'),
  },
]

export async function runResearch(
  config: EventConfig,
  input: IngestedInput,
  toolContext?: ToolContext,
): Promise<ResearchResult> {
  const results = await Promise.allSettled(
    RESEARCH_PERSONAS.map(async ({ persona, prompt }) => {
      const res = await tryRun(config, persona, prompt(input, config), { tools: true, toolContext })
      if (!res) return { persona, findings: [] as ResearchFinding[], degraded: persona }
      const findings = res.parsed ? toFindings(res.parsed, persona) : []
      return { persona, findings, degraded: findings.length === 0 ? persona : null }
    }),
  )

  const findings: ResearchFinding[] = []
  const degraded: string[] = []

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      const { persona, findings: fs } = r.value
      findings.push(...fs)
      if (r.value.degraded) degraded.push(r.value.degraded)
      if (fs.length > 0) {
        emitMessage(
          persona,
          fs.map((f) => `${f.section}: ${f.claim}`).join('\n\n'),
          fs.flatMap((f) => f.evidence.map((e) => `${e.source} (${e.confidence})`)),
        )
      }
    } else {
      // Persona threw outside tryRun (shouldn't happen, but be safe)
      degraded.push('unknown research persona')
    }
  }

  const evidenceText = renderFindings(findings)

  return { findings, evidenceText, degraded }
}

function renderFindings(findings: ResearchFinding[]): string {
  if (findings.length === 0) return '_No research findings collected this run._\n'
  return findings.map((f) =>
    `## ${f.role} — ${f.section}\n\n${f.claim}\n\n*Evidence: ${f.evidence.map((e) => `${e.source} (${e.confidence})${e.note ? ` — ${e.note}` : ''}`).join('; ') || 'none cited'}*`,
  ).join('\n\n')
}

// ── Synthesize (decision-lead) ─────────────────────────────────────────────

export async function synthesizeFindings(config: EventConfig, findings: ResearchFinding[]): Promise<string> {
  const res = await tryRun(config, 'decision-lead', [
    'Synthesize the research findings into a concise brief for the Innovation Scout.',
    'Merge overlapping claims, resolve conflicts (favor high-confidence), flag gaps.',
    'Return JSON: { "synthesis": string }',
    '',
    section('All findings', renderFindings(findings), 12_000),
    section('Problem statements', config.problemStatements.join('\n\n')),
  ].join('\n\n'))

  const synth = res?.parsed ? (res.parsed as { synthesis?: unknown }).synthesis : undefined
  const out = typeof synth === 'string' && synth.trim() ? synth : 'No synthesis produced (LLM unavailable).'
  emitMessage('decision-lead', out)
  return out
}

// ── Ideate (innovation-scout) ──────────────────────────────────────────────

export async function ideate(
  config: EventConfig,
  synthesis: string,
  findings: ResearchFinding[],
): Promise<{ ideas: IdeaCard[]; degraded: boolean }> {
  const res = await tryRun(config, 'innovation-scout', [
    'Generate 5-8 candidate ideas that answer the problem statement VERBATIM.',
    'Each idea needs: oneLinePitch, problemFit, targetUser, techApproach, differentiator',
    '(non-CRUD), dataLeverage (which dataset/how), gatingFit, buildScope.',
    'Span safe → bold. No AI-wrapper-only ideas.',
    'Return JSON: { "ideas": [{ "oneLinePitch": string, "problemFit": string, "targetUser": string, "techApproach": string, "differentiator": string, "dataLeverage": string, "gatingFit": string, "buildScope": string }] }',
    '',
    section('Problem statements', config.problemStatements.join('\n\n')),
    section('Synthesis', synthesis),
    section('Team', `size=${config.team.size}, skills=${config.team.skills.join(', ')}`),
    section('Findings summary', renderFindings(findings), 6_000),
  ].join('\n\n'), { maxTokens: 16_000 })

  const ideas = res?.parsed ? toIdeaCards(res.parsed) : []
  let result: { ideas: IdeaCard[]; degraded: boolean }
  if (ideas.length >= 3) {
    result = { ideas, degraded: false }
  } else if (ideas.length >= 1) {
    // Keep real LLM ideas when possible — only pad the shortfall with stubs.
    const stubs = stubIdeas(config)
    const padded = [...ideas]
    const used = new Set(stubs.map((s) => s.oneLinePitch))
    for (const stub of stubs) {
      if (padded.length >= 3) break
      if (used.has(stub.oneLinePitch)) continue
      stub.id = `idea-${padded.length + 1}`
      padded.push(stub)
    }
    result = { ideas: padded, degraded: true }
  } else {
    result = { ideas: stubIdeas(config), degraded: true }
  }

  emitMessage(
    'innovation-scout',
    result.ideas.map((i) => `**${i.id}** — ${i.oneLinePitch}\n  · differentiator: ${i.differentiator}\n  · data: ${i.dataLeverage}`).join('\n\n'),
    result.degraded ? ['degraded: LLM unavailable — fallback ideas'] : [],
  )
  return result
}

/** Deterministic fallback ideas used when the Innovation Scout can't run. */
function stubIdeas(config: EventConfig): IdeaCard[] {
  const problem = config.problemStatements[0]?.slice(0, 120) ?? 'the prompt'
  return [
    {
      id: 'idea-1',
      oneLinePitch: `AI-powered analysis for: ${problem}`,
      problemFit: 'Directly addresses the prompt',
      targetUser: 'The primary stakeholder from the problem statement',
      techApproach: 'LLM-powered analysis + data pipeline',
      differentiator: 'Turns provided data into actionable insights',
      dataLeverage: 'Uses provided datasets as the core mechanism',
      gatingFit: 'Fits the primary track',
      buildScope: 'MVP: ingest → analyze → report. ~12h.',
    },
    {
      id: 'idea-2',
      oneLinePitch: `Real-time monitoring dashboard for: ${problem}`,
      problemFit: 'Answers the prompt with live visibility',
      targetUser: 'Operations teams',
      techApproach: 'Web dashboard + anomaly detection',
      differentiator: 'Live monitoring with alerts',
      dataLeverage: 'Streams provided data into live visualizations',
      gatingFit: 'Fits the primary track',
      buildScope: 'MVP: dashboard + alerts. ~14h.',
    },
    {
      id: 'idea-3',
      oneLinePitch: `Decision-support copilot for: ${problem}`,
      problemFit: 'Answers the prompt with guided decisions',
      targetUser: 'Decision makers',
      techApproach: 'LLM copilot over the provided data',
      differentiator: 'Natural-language decision support',
      dataLeverage: 'Ingests raw data files directly',
      gatingFit: 'Fits the primary track',
      buildScope: 'MVP: copilot + data ingest. ~10h.',
    },
  ]
}

// ── Revise Top 3 from human feedback (pick-winner refinement) ──────────────

/**
 * Rewrite the Top 3 candidate cards from the human's pick-winner feedback plus
 * the last round's reviewer verdicts. Idea `id`s stay stable so scores carry
 * across rounds. Degrades to returning the candidates unchanged when the LLM
 * is unavailable or returns nothing parseable (the orchestrator's refineRounds
 * cap bounds any resulting no-op loops).
 */
export async function reviseIdeas(
  config: EventConfig,
  candidates: IdeaCard[],
  feedback: string,
  verdicts: ReviewerVerdict[],
  findings: ResearchFinding[],
  synthesis: string,
): Promise<IdeaCard[]> {
  const lastVerdicts = verdicts.length > 0
    ? verdicts.map((v) => `${v.reviewer}: ${v.verdict.toUpperCase()}${v.feedback.length > 0 ? ' → ' + v.feedback.map((f) => `${f.topic}: ${f.requiredChange}`).join('; ') : ''}`).join('\n')
    : '_No reviewer feedback on the last round._'

  const res = await tryRun(config, 'innovation-scout', [
    'You are refining the Top 3 candidate ideas for a hackathon. A human gave feedback on the current set.',
    'Rewrite EACH card so it directly addresses the human feedback AND the reviewers\' required changes.',
    'Keep each idea\'s `id` EXACTLY as given (stable ids let scores carry over). Keep the same number of cards.',
    'Return JSON: { "ideas": [{ "id": string, "oneLinePitch": string, "problemFit": string, "targetUser": string, "techApproach": string, "differentiator": string, "dataLeverage": string, "gatingFit": string, "buildScope": string }] }',
    '',
    section('Human feedback', feedback),
    section('Reviewer verdicts (last round)', lastVerdicts),
    section('Current Top 3 cards', JSON.stringify(candidates.map((c) => ({ id: c.id, oneLinePitch: c.oneLinePitch, problemFit: c.problemFit, targetUser: c.targetUser, techApproach: c.techApproach, differentiator: c.differentiator, dataLeverage: c.dataLeverage, gatingFit: c.gatingFit, buildScope: c.buildScope })), null, 2)),
    section('Synthesis', synthesis, 4_000),
    section('Findings', renderFindings(findings), 6_000),
  ].join('\n\n'), { maxTokens: 16_000 })

  const parsed = res?.parsed ? toIdeaCards(res.parsed) : []
  if (parsed.length === 0) {
    emitMessage('innovation-scout', 'Refinement degraded (LLM unavailable) — Top 3 unchanged.', ['degraded: LLM unavailable'])
    return candidates
  }

  // Map revised cards back onto the originals: stable ids + carry over fields
  // the LLM isn't asked to regenerate (e.g. feasibility).
  const byId = new Map(candidates.map((c) => [c.id, c]))
  const revised = parsed.map((card, i) => {
    const src = byId.get(card.id) ?? candidates[i]
    return { ...card, id: src?.id ?? card.id, feasibility: src?.feasibility }
  })

  emitMessage('innovation-scout', `Refined the Top 3 from your feedback — ${revised.length} card(s) updated.`, [])
  return revised
}

// ── Loop callbacks (debate / score / review) ───────────────────────────────

export function makeDebateCallback(config: EventConfig, findings: ResearchFinding[], synthesis: string) {
  return async (
    candidates: IdeaCard[],
    roundNumber: number,
  ): Promise<DeliberationRound['debate']> => {
    const res = await tryRun(config, 'devils-advocate', [
      `Round ${roundNumber}. Adversarially critique each surviving candidate against the research findings.`,
      'Force rebuttals. Kill weak ideas with cited reasons. No "I just don\'t like it".',
      'Return JSON: { "debate": [{ "persona": string, "text": string, "citations": string[] }] }',
      '',
      section('Candidates', JSON.stringify(candidates.map((c) => ({ id: c.id, pitch: c.oneLinePitch, differentiator: c.differentiator, dataLeverage: c.dataLeverage })), null, 2)),
      section('Findings', renderFindings(findings), 6_000),
      section('Synthesis', synthesis, 4_000),
    ].join('\n\n'))

    const messages = res?.parsed ? toDebateMessages(res.parsed, 'devils-advocate') : []
    if (messages.length > 0) {
      for (const m of messages) emitMessage('devils-advocate', m.text, m.citations, roundNumber)
      return messages
    }

    // Degradation: deterministic critique
    const stub = candidates.map((c) => ({
      persona: 'devils-advocate' as const,
      text: `Critique of "${c.oneLinePitch}": the differentiator needs stronger evidence of real user value.`,
      citations: ['degraded: LLM unavailable'],
    }))
    for (const m of stub) emitMessage('devils-advocate', m.text, m.citations, roundNumber)
    return stub
  }
}

export function makeScoreCallback(config: EventConfig, findings: ResearchFinding[]) {
  return async (
    candidates: IdeaCard[],
    roundNumber: number,
  ): Promise<DeliberationRound['scores']> => {
    const res = await tryRun(config, 'decision-lead', [
      `Round ${roundNumber}. Score each candidate 0-10 per criterion: problemFit, feasibility,`,
      'innovation, stakeholderAlignment, dataLeverage, demoAbility. Use the research findings as evidence.',
      'Return JSON: { "scores": [{ "ideaId": string, "problemFit": number, "feasibility": number, "innovation": number, "stakeholderAlignment": number, "dataLeverage": number, "demoAbility": number }] }',
      '',
      section('Candidates', JSON.stringify(candidates.map((c) => ({ id: c.id, pitch: c.oneLinePitch })), null, 2)),
      section('Findings', renderFindings(findings), 6_000),
    ].join('\n\n'))

    const scores = res?.parsed ? toScores(res.parsed, candidates.map((c) => c.id)) : []
    if (scores.length >= candidates.length) return scores

    // Degradation: deterministic scores
    return candidates.map((c) => ({
      ideaId: c.id,
      criteria: {
        problemFit: 7, feasibility: 7, innovation: 6,
        stakeholderAlignment: 6, dataLeverage: 7, demoAbility: 6,
      },
      total: 0,
    }))
  }
}

export function makeReviewCallback(
  config: EventConfig,
  findings: ResearchFinding[],
  weightsText: string,
  directives?: DirectiveBroker,
) {
  // Build event-specific context so reviewers calibrate expectations correctly.
  const hasData = (config.dataFiles?.length ?? 0) > 0
  const hasSponsors = (config.sponsors?.length ?? 0) > 0
  const isRubricDriven = !!(config.rubricUrl) || hasSponsors

  const panel: { persona: PanelPersonaId; context: string }[] = [
    {
      persona: 'judge',
      context: [
        'You are the Judge for this hackathon.',
        isRubricDriven
          ? 'Apply the event rubric and gating rules criterion-by-criterion. Approve only if every criterion is >= 6/10 and all gating rules pass.'
          : 'This is an open-ended hackathon (no formal rubric). Focus on: Does the idea solve a REAL, specific personal pain point? Is it innovative and different from existing tools? Can it be built and demoed convincingly in the time window? Approve if the idea is clearly buildable, solves a genuine problem, and has a compelling demo path.',
        hasData ? 'Data leverage matters: reward ideas that use the provided datasets.' : 'No datasets are provided. dataLeverage should be scored based on how the idea could leverage any available data sources or generate its own data — do NOT penalize for lack of provided data.',
        `Weights: ${weightsText}`,
        'Return JSON: { "verdict": "approve"|"revise", "feedback": [{ "topic": string, "issue": string, "requiredChange": string, "evidence"?: { "source": string, "confidence": "high"|"medium"|"low" } }], "rubricScores": { "problemFit": number, "feasibility": number, "innovation": number, "stakeholderAlignment": number, "dataLeverage": number, "demoAbility": number } }',
      ].join('\n'),
    },
    {
      persona: 'sponsor-reviewer',
      context: [
        hasSponsors
          ? 'Review each candidate from the sponsors\' perspective: stated goals, challenge tracks, prize criteria.'
          : 'This hackathon is hosted by the Cursor Calgary community (Cursor AI coding tool users). Assess: Would this project impress the Cursor community? Does it showcase what you can build with AI-assisted development? Does it have a clear connection to developer productivity, AI tooling, or developer experience?',
        'Return JSON: { "verdict": "approve"|"revise", "feedback": [...] }',
      ].join('\n'),
    },
    {
      persona: 'audience-reviewer',
      context: [
        'Review each candidate from the audience/end-user perspective.',
        'For open-ended prompts: the "pain point" must be SPECIFIC and PERSONAL — not "help developers" or "improve productivity" but something like "I always forget where I parked" or "I waste 30 min every morning deciding what to eat."',
        'Rate: Would you actually USE this? Is the demo compelling? Could someone explain it in 30 seconds and get a "oh, I need that" reaction?',
        'Return JSON: { "verdict": "approve"|"revise", "feedback": [...] }',
      ].join('\n'),
    },
    {
      persona: 'build-feasibility-reviewer',
      context: [
        'Assess buildability within the build window. Propose MVP scope cuts that make candidates feasible.',
        `Team: size=${config.team.size}, skills=${config.team.skills.join(', ')}.`,
        'For open-ended prompts: prefer ideas that can show a working demo (not just a slide deck). The ideal project has a narrow scope with a polished core flow.',
        'Return JSON: { "verdict": "approve"|"revise", "feedback": [...] }',
      ].join('\n'),
    },
  ]

  return async (
    candidates: IdeaCard[],
    scores: DeliberationRound['scores'],
    roundNumber: number,
  ): Promise<ReviewerVerdict[]> => {
    const candidateText = JSON.stringify(candidates.map((c) => ({
      id: c.id, pitch: c.oneLinePitch, differentiator: c.differentiator,
      dataLeverage: c.dataLeverage, buildScope: c.buildScope,
    })), null, 2)

    const results = await Promise.allSettled(
      panel.map(async ({ persona, context }) => {
        // Consume any human interjections targeted at this reviewer and inject
        // them as binding guidance for this round's verdict.
        const human = directives ? directives.consume(persona) : []
        const directivesText = human.length > 0
          ? section('Human directives (from the control room)', human.map((d) => `[${d.id}] ${d.message}`).join('\n'))
          : ''

        const res = await tryRun(config, persona, [
          context,
          directivesText,
          '',
          `Round ${roundNumber}. Review these candidates:`,
          section('Candidates', candidateText, 10_000),
          section('Scores', JSON.stringify(scores, null, 2), 4_000),
          section('Findings', renderFindings(findings), 4_000),
        ].join('\n\n'))

        if (!res?.parsed) return { reviewer: persona, verdict: 'revise' as const, feedback: [] }
        return toVerdict(res.parsed, persona)
      }),
    )

    const verdicts: ReviewerVerdict[] = []
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        verdicts.push(r.value)
      } else {
        // Persona failed entirely — degrade to approve with a flagged note
        const persona = (panel[verdicts.length]?.persona ?? 'judge') as PanelPersonaId
        verdicts.push({ reviewer: persona, verdict: 'approve', feedback: [] })
      }
    }

    // Archive the directives that were handed to this round's panel (the loop
    // drains them via collectDirectives → takeConsumed for the round record).
    directives?.finishRound()

    return verdicts
  }
}
