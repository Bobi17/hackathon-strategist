import type { EventConfig } from './types.js'

export interface ConfigError {
  field: string
  message: string
}

/**
 * Validate an EventConfig object. Returns a list of errors; empty = valid.
 * This is a simple schema check — no external validation library needed.
 */
export function validateConfig(raw: Record<string, unknown>): ConfigError[] {
  const errors: ConfigError[] = []

  if (typeof raw !== 'object' || raw === null) {
    return [{ field: 'root', message: 'Config must be a JSON object.' }]
  }

  // Required strings
  for (const key of ['slug', 'name'] as const) {
    if (typeof raw[key] !== 'string' || !raw[key]) {
      errors.push({ field: key, message: `${key} is required and must be a non-empty string.` })
    }
  }

  // Required arrays
  if (!Array.isArray(raw.websiteUrls) || raw.websiteUrls.length === 0) {
    errors.push({ field: 'websiteUrls', message: 'At least one website URL is required.' })
  }

  if (!Array.isArray(raw.problemStatements) || raw.problemStatements.length === 0) {
    errors.push({ field: 'problemStatements', message: 'At least one problem statement is required.' })
  }

  // Team
  const team = raw.team as Record<string, unknown> | undefined
  if (!team || typeof team !== 'object') {
    errors.push({ field: 'team', message: 'team is required: { size: number, skills: string[] }.' })
  } else {
    if (typeof team.size !== 'number' || team.size < 1) {
      errors.push({ field: 'team.size', message: 'team.size must be a positive integer.' })
    }
    if (!Array.isArray(team.skills)) {
      errors.push({ field: 'team.skills', message: 'team.skills must be an array of strings.' })
    }
  }

  // Mode
  if (raw.mode !== undefined && raw.mode !== 'headless' && raw.mode !== 'ui') {
    errors.push({ field: 'mode', message: 'mode must be "headless" or "ui".' })
  }

  // Optional arrays
  for (const key of ['dataFiles', 'pastWinnersUrls'] as const) {
    if (raw[key] !== undefined && !Array.isArray(raw[key])) {
      errors.push({ field: key, message: `${key} must be an array.` })
    }
  }

  // Browser / fetch escalation
  if (raw.useBrowser !== undefined && typeof raw.useBrowser !== 'boolean') {
    errors.push({ field: 'useBrowser', message: 'useBrowser must be a boolean.' })
  }
  if (raw.minContentChars !== undefined && (typeof raw.minContentChars !== 'number' || raw.minContentChars <= 0)) {
    errors.push({ field: 'minContentChars', message: 'minContentChars must be a positive number.' })
  }

  // Budgets
  const budgets = raw.budgets as Record<string, unknown> | undefined
  if (budgets && typeof budgets === 'object') {
    for (const k of ['researchHours', 'maxRounds', 'perRoundMinutes'] as const) {
      if (budgets[k] !== undefined && (typeof budgets[k] !== 'number' || budgets[k] <= 0)) {
        errors.push({ field: `budgets.${k}`, message: `budgets.${k} must be a positive number.` })
      }
    }
  }

  return errors
}

/**
 * Load, merge with defaults, and validate a config.
 * Returns the merged config or throws with all validation errors.
 */
export async function loadConfig(path: string): Promise<EventConfig> {
  const raw = (await import(path, { with: { type: 'json' } })).default as Record<string, unknown>
  const errors = validateConfig(raw)
  if (errors.length > 0) {
    const msg = errors.map((e) => `  ${e.field}: ${e.message}`).join('\n')
    throw new Error(`Invalid config at ${path}:\n${msg}`)
  }
  return raw as unknown as EventConfig
}
