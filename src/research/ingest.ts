// ── Ingestion pipeline — fetch, normalize, cache ───────────────────────────

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { EventConfig } from '../config/types.js'
import { normalizeHTML } from './parsers/html.js'

export interface IngestedInput {
  siteSections: { url: string; content: string }[]
  problemStatements: string[]
  dataFilePaths: string[]
  rubricText?: string
  gatingText?: string
  gaps: string[]       // missing critical inputs, flagged but not fatal
}

/**
 * Ingest all inputs for an event. Fetches websites, reads local files,
 * and flags gaps. Results are cached under output/<slug>/.cache/.
 */
export async function ingestEvent(config: EventConfig): Promise<IngestedInput> {
  const cacheDir = join(config.outputDir ?? 'output', config.slug, '.cache')
  await mkdir(cacheDir, { recursive: true })

  const siteSections: IngestedInput['siteSections'] = []
  const gaps: string[] = []

  // ── Fetch event websites ────────────────────────────────────────────
  for (const url of config.websiteUrls) {
    const cacheFile = join(cacheDir, `site-${Buffer.from(url).toString('base64url').slice(0, 60)}.txt`)
    let content: string

    try {
      const cached = await readFile(cacheFile, 'utf-8')
      content = cached
    } catch {
      // Not cached — fetch
      const result = await fetchWithTimeout(url)
      if (result) {
        content = normalizeHTML(result)
        await writeFile(cacheFile, content, 'utf-8')
      } else {
        gaps.push(`Could not fetch website: ${url}`)
        content = `[FETCH FAILED: ${url}]`
      }
    }

    siteSections.push({ url, content })
  }

  // ── Read local data files ───────────────────────────────────────────
  const dataFilePaths = config.dataFiles ?? []

  // ── Rubric (if URL provided) ────────────────────────────────────────
  let rubricText: string | undefined
  if (config.rubricUrl) {
    const result = await fetchWithTimeout(config.rubricUrl)
    if (result) {
      rubricText = normalizeHTML(result)
    } else {
      gaps.push(`Could not fetch rubric: ${config.rubricUrl}`)
    }
  }

  // ── Past winners ────────────────────────────────────────────────────
  if (config.pastWinnersUrls?.length) {
    for (const url of config.pastWinnersUrls) {
      const result = await fetchWithTimeout(url)
      if (result) {
        siteSections.push({ url, content: normalizeHTML(result) })
      } else {
        gaps.push(`Could not fetch past winners: ${url}`)
      }
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

async function fetchWithTimeout(url: string, timeoutMs = 15_000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'HackathonStrategist/0.1 (research-bot)' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}
