// ── Persona & Stage ─────────────────────────────────────────────────────────

export type PersonaId =
  | 'orchestrator'
  | 'event-intelligence-analyst'
  | 'sponsor-stakeholder-analyst'
  | 'past-winners-analyst'
  | 'data-analyst'
  | 'innovation-scout'
  | 'devils-advocate'
  | 'decision-lead'
  | 'judge'
  | 'sponsor-reviewer'
  | 'audience-reviewer'
  | 'build-feasibility-reviewer'

export type PanelPersonaId =
  | 'judge'
  | 'sponsor-reviewer'
  | 'audience-reviewer'
  | 'build-feasibility-reviewer'

export type Stage =
  | 'ingest'
  | 'research'
  | 'synthesize'
  | 'ideate'
  | 'loop'
  | 'finalize'
  | 'artifacts'

export type Confidence = 'high' | 'medium' | 'low'

// ── Research ───────────────────────────────────────────────────────────────

export interface Evidence {
  source: string
  confidence: Confidence
  note?: string
}

export interface ResearchFinding {
  role: PersonaId
  section: string
  claim: string
  evidence: Evidence[]
}

// ── Ideas & Scoring ────────────────────────────────────────────────────────

export interface IdeaCard {
  id: string
  oneLinePitch: string
  problemFit: string
  targetUser: string
  techApproach: string
  differentiator: string
  dataLeverage: string
  gatingFit: string
  buildScope: string
  feasibility?: FeasibilityAssessment
}

export interface FeasibilityAssessment {
  buildWindowHours: number
  effortHours: number
  risk: 'low' | 'med' | 'high'
  cuts: string[]
}

export interface ScoreWeights {
  problemFit: number
  feasibility: number
  innovation: number
  stakeholderAlignment: number
  dataLeverage: number
  demoAbility: number
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  problemFit: 0.25,
  feasibility: 0.20,
  innovation: 0.20,
  stakeholderAlignment: 0.15,
  dataLeverage: 0.10,
  demoAbility: 0.10,
}

export interface Score {
  ideaId: string
  criteria: Record<keyof ScoreWeights, number>
  total: number
  rank?: number
}

// ── Reviewer Panel ─────────────────────────────────────────────────────────

export interface FeedbackItem {
  topic: string
  issue: string
  requiredChange: string
  evidence?: Evidence
}

export interface ReviewerVerdict {
  reviewer: PanelPersonaId
  verdict: 'approve' | 'revise'
  feedback: FeedbackItem[]
  rubricScores?: Record<string, number>
}

// ── Human directives ───────────────────────────────────────────────────────

export interface HumanDirective {
  id: string
  at: number
  from: 'human'
  target: PanelPersonaId | 'all'
  message: string
}

// ── Deliberation ───────────────────────────────────────────────────────────

export interface DebateMessage {
  persona: PersonaId
  text: string
  citations: string[]
}

export interface DeliberationRound {
  number: number
  candidates: IdeaCard[]
  scores: Score[]
  debate: DebateMessage[]
  verdicts: ReviewerVerdict[]
  directivesApplied: HumanDirective[]
  revisions: { feedbackId: string; whatChanged: string }[]
}

export interface LoopOutcome {
  status: 'approved' | 'escalated'
  rounds: DeliberationRound[]
  top3: IdeaCard[]
  winner: IdeaCard
  approvals: Record<PanelPersonaId, boolean>
  dissentLog: { reviewer: PanelPersonaId; objection: string }[]
}

// ── Event bus ──────────────────────────────────────────────────────────────

export type LoopEvent =
  | { kind: 'run'; status: 'starting' | 'running' | 'complete' | 'error'; message?: string }
  | { kind: 'stage'; stage: Stage; at: number }
  | { kind: 'round'; number: number; action: 'start' | 'end' }
  | { kind: 'message'; round: number; persona: PersonaId; text: string; citations: string[] }
  | { kind: 'score'; round: number; scores: Score[] }
  | { kind: 'verdict'; round: number; verdict: ReviewerVerdict }
  | { kind: 'directive'; directive: HumanDirective; accepted: boolean }
  | { kind: 'gate'; gate: string; decision: 'requested' | 'resolved' | 'escalated' }

export interface StreamEvent {
  seq: number
  ts: number
  event: LoopEvent
}
