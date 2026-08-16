import type { ScoreWeights } from '../data/types.js'

export type StrategistMode = 'headless' | 'ui'

export interface EventConfig {
  slug: string
  name: string
  websiteUrls: string[]
  problemStatements: string[]
  dataFiles?: string[]
  rubricUrl?: string
  sponsors?: SponsorInfo[]
  pastWinnersUrls?: string[]
  team: TeamConfig
  weights?: Partial<ScoreWeights>
  budgets?: BudgetConfig
  mode: StrategistMode
  gates?: GateConfig
  outputDir?: string
  model?: Record<string, string>
  concurrency?: number
  /** Force the browser engine for all website/past-winners fetches (SPA / login-gated events). Default false — escalate automatically. */
  useBrowser?: boolean
  /** Normalized-content length (chars) below which a fetch is treated as too thin and escalated to the browser engine. Default 300. */
  minContentChars?: number
}

export interface SponsorInfo {
  name: string
  url?: string
  track?: string
  prize?: string
}

export interface TeamConfig {
  size: number
  skills: string[]
}

export interface BudgetConfig {
  researchHours?: number
  maxRounds?: number
  perRoundMinutes?: number
  continueWithoutPause?: boolean
  /** Max pick-winner feedback iterations (each rewrites the Top 3 + re-deliberates). Default 3. */
  refineRounds?: number
}

export interface GateConfig {
  approveTop3?: boolean
  /** Replaced by pickWinner — kept for config-file backward compatibility (ignored). */
  approveWinner?: boolean
  /** Interactive winner checkpoint: present the Top 3, let the human pick one or give feedback to refine. Default on in ui mode. */
  pickWinner?: boolean
}
