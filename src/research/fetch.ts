// ── Escalation fetcher — plain fetch → browser → human (auth gate / paste) ──
//
// The ingestion pipeline and the persona webFetch tool both funnel through
// fetchWithEscalation so login-gated and JS-rendered pages are handled in one
// place:
//   1. plain fetch     — fast path for static sites
//   2. browser render  — SPA / thin content, reusing the logged-in session
//   3. human-in-loop   — interactive UI mode: open a visible window to sign in,
//                        then re-render; or accept pasted page content
//   4. gap             — headless without a usable session, or the human skips

import type { EventConfig } from '../config/types.js'
import type { ControlRoomServer } from '../control-room/server.js'
import type { IngestAuthResolution } from '../data/types.js'
import type { BrowserSession } from './browser.js'
import { normalizeHTML } from './parsers/html.js'

export interface FetchOutcome {
  content: string
  source: 'fetch' | 'browser' | 'pasted' | 'failed'
}

export interface EscalationDeps {
  session: BrowserSession | null
  server?: ControlRoomServer
  /** Headless / continue-without-pause: never pause for a human. */
  auto: boolean
}

export const DEFAULT_MIN_CONTENT = 300

export async function fetchWithTimeout(url: string, timeoutMs = 15_000): Promise<string | null> {
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

/**
 * Fetch a URL, escalating up the chain until content is usable. Never throws —
 * a failed fetch degrades to `{ source: 'failed' }` (caller records a gap).
 */
export async function fetchWithEscalation(
  config: EventConfig,
  url: string,
  deps: EscalationDeps,
): Promise<FetchOutcome> {
  const minContent = config.minContentChars ?? DEFAULT_MIN_CONTENT

  // 1. Plain fetch — fast path for static sites.
  const fetched = (await fetchWithTimeout(url)) ?? ''
  const fetchedContent = fetched ? normalizeHTML(fetched) : ''
  const fetchedUsable = fetchedContent.length >= minContent

  if (!config.useBrowser && fetchedUsable) {
    return { content: fetchedContent, source: 'fetch' }
  }

  // 2. Browser render — SPA / thin content / forced via useBrowser.
  if (deps.session) {
    const rendered = await deps.session.render(url)
    if (rendered && rendered.length >= minContent) {
      return { content: rendered, source: 'browser' }
    }
  }

  // 3. Human-in-the-loop (interactive UI mode only).
  if (deps.server && !deps.auto) {
    await deps.session?.openForLogin(url)
    const resolution: IngestAuthResolution = await deps.server.requestIngestAuth(url)
    if (resolution.kind === 'retry' && deps.session) {
      // The human signed in — re-render with the now-logged-in session.
      const rendered = await deps.session.render(url)
      if (rendered && rendered.length > 0) return { content: rendered, source: 'browser' }
    } else if (resolution.kind === 'pasted' && resolution.text.trim()) {
      return { content: resolution.text.trim().slice(0, 50_000), source: 'pasted' }
    }
    // escalated → fall through to the fallback below
  }

  // Fall back to whatever plain fetch returned when it was usable (covers the
  // useBrowser-but-browser-failed case); otherwise the caller flags a gap.
  if (fetchedUsable) return { content: fetchedContent, source: 'fetch' }
  return { content: '', source: 'failed' }
}
