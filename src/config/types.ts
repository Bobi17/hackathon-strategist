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
}

export interface GateConfig {
  approveTop3?: boolean
  approveWinner?: boolean
}
