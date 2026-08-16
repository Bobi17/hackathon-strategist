// ── Ingestion pipeline — fetch (with escalation), normalize, cache ─────────

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { EventConfig } from '../config/types.js'
import { fetchWithEscalation, type EscalationDeps } from './fetch.js'

export interface IngestedInput {
  siteSections: { url: string; content: string }[]
  problemStatements: string[]
  dataFilePaths: string[]
  rubricText?: string
  gatingText?: string
  gaps: string[]       // missing critical inputs, flagged but not fatal
}

/**
 * Ingest all inputs for an event. Fetches websites — escalating to a browser
 * render / human sign-in gate when a page is login-walled or JS-rendered —
 * reads local files, and flags gaps. Results are cached under
 * output/<slug>/.cache/ so a re-run skips re-fetching and re-logging-in.
 *
 * `deps` supplies the browser session and control-room server for escalation;
 * the default (no session, auto) keeps existing headless callers unchanged.
 */
export async function ingestEvent(
  config: EventConfig,
  deps: EscalationDeps = { session: null, auto: true },
): Promise<IngestedInput> {
  const cacheDir = join(config.outputDir ?? 'output', config.slug, '.cache')
  await mkdir(cacheDir, { recursive: true })

  const siteSections: IngestedInput['siteSections'] = []
  const gaps: string[] = []

  /** Fetch one URL (any source) with a per-URL cache. Returns null on failure. */
  async function fetchSection(url: string, label: string): Promise<string | null> {
    const cacheFile = join(cacheDir, `site-${Buffer.from(url).toString('base64url').slice(0, 60)}.txt`)

    // Cached content (from any prior source — fetch, browser, or pasted) is
    // reused so a re-run skips fetching and any login.
    try {
      return await readFile(cacheFile, 'utf-8')
    } catch {
      /* not cached — fetch */
    }

    const outcome = await fetchWithEscalation(config, url, deps)
    if (outcome.source === 'failed' || !outcome.content) {
      gaps.push(`Could not fetch ${label}: ${url}`)
      return null
    }
    await writeFile(cacheFile, outcome.content, 'utf-8')
    return outcome.content
  }

  // ── Event websites ────────────────────────────────────────────────────
  for (const url of config.websiteUrls) {
    const content = await fetchSection(url, 'website')
    if (content) siteSections.push({ url, content })
  }

  // ── Read local data files ───────────────────────────────────────────
  const dataFilePaths = config.dataFiles ?? []

  // ── Rubric (if URL provided) ────────────────────────────────────────
  let rubricText: string | undefined
  if (config.rubricUrl) {
    rubricText = (await fetchSection(config.rubricUrl, 'rubric')) ?? undefined
  }

  // ── Past winners ────────────────────────────────────────────────────
  if (config.pastWinnersUrls?.length) {
    for (const url of config.pastWinnersUrls) {
      const content = await fetchSection(url, 'past winners')
      if (content) siteSections.push({ url, content })
    }
  }

  return {
    siteSections,
    problemStatements: config.problemStatements,
    dataFilePaths,
    rubricText,
    gaps,
  }
}
