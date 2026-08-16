import type { EventConfig } from './types.js'

export const DEFAULT_CONFIG: Required<
  Pick<
    EventConfig,
    'outputDir' | 'concurrency' | 'mode' | 'budgets' | 'gates' | 'team'
  >
> = {
  outputDir: 'output',
  concurrency: 4,
  mode: 'headless',
  team: { size: 3, skills: [] },
  budgets: {
    researchHours: 3,
    maxRounds: 3,
    perRoundMinutes: 20,
    continueWithoutPause: false,
    refineRounds: 3,
  },
  gates: {
    approveTop3: true,
    pickWinner: true,
  },
}
