// ── Browser session — Playwright Chromium with a persistent, logged-in profile ──
//
// Escalation path for login-gated and JS-rendered hackathon pages. A single
// persistent Chromium context keeps one profile dir, so a human can sign in once
// (visible window) and every subsequent fetch in the run — and on later runs of
// the same event — reuses the logged-in session.
//
// The profile lives at output/<slug>/.cache/browser-profile/ (gitignored).
// Delete that directory to log out / reset the session.
//
// Playwright is lazy-loaded so the base install stays light: the Chromium
// download only matters when a URL actually needs the browser. If it's missing
// we log an install hint and return null — the caller degrades, never crashes.

import type { BrowserContext, Page } from 'playwright'

export interface BrowserSession {
  /** Render a page and return its visible text (null on failure / missing browser). */
  render(url: string, opts?: { waitMs?: number }): Promise<string | null>
  /** Open a visible window at url and leave it open so a human can sign in. */
  openForLogin(url: string): Promise<void>
  close(): Promise<void>
}

export interface BrowserSessionOptions {
  /** Launch headful (visible). Needed for the interactive login handoff. Default false. */
  headless?: boolean
  /** Cap extracted text length (chars). Default 50_000. */
  maxChars?: number
  /** Bounded wait for the network to go idle after load (ms). Default 4_000. */
  waitMs?: number
}

export const INSTALL_HINT =
  'Install with: pnpm add playwright && pnpm exec playwright install chromium'

/** Create a browser session, or null when Playwright / Chromium is unavailable. */
export async function createBrowserSession(
  profileDir: string,
  opts: BrowserSessionOptions = {},
): Promise<BrowserSession | null> {
  let pw: typeof import('playwright') | null = null
  try {
    pw = await import('playwright')
  } catch {
    console.warn(`   ⚠  Browser engine unavailable — ${INSTALL_HINT}`)
    return null
  }

  const maxChars = opts.maxChars ?? 50_000
  const headless = opts.headless ?? false
  let context: BrowserContext | null = null
  let page: Page | null = null

  async function ensureContext(): Promise<BrowserContext | null> {
    if (context) return context
    try {
      context = await pw!.chromium.launchPersistentContext(profileDir, {
        headless,
        viewport: { width: 1280, height: 900 },
      })
      return context
    } catch (err) {
      console.warn(
        `   ⚠  Browser launch failed (${INSTALL_HINT}): ${err instanceof Error ? err.message : String(err)}`,
      )
      context = null
      return null
    }
  }

  return {
    async render(url, renderOpts = {}) {
      const ctx = await ensureContext()
      if (!ctx) return null
      const waitMs = renderOpts.waitMs ?? opts.waitMs ?? 4_000
      try {
        page = page ?? (await ctx.newPage())
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        // Let client-side rendering finish; bounded so slow apps don't hang us.
        try {
          await page.waitForLoadState('networkidle', { timeout: waitMs })
        } catch {
          /* not idle in time — proceed with what we have */
        }
        // A short settle helps SPAs paint their real content.
        await page.waitForTimeout(500)
        const text = await page.evaluate(() => document.body?.innerText ?? '')
        const collapsed = text.replace(/\s+/g, ' ').trim()
        const capped = collapsed.slice(0, maxChars)
        return capped.length > 0 ? capped : null
      } catch (err) {
        console.warn(
          `   ⚠  Browser render failed for ${url}: ${err instanceof Error ? err.message : String(err)}`,
        )
        return null
      }
    },

    async openForLogin(url) {
      const ctx = await ensureContext()
      if (!ctx) return
      try {
        page = page ?? (await ctx.newPage())
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      } catch (err) {
        console.warn(
          `   ⚠  Could not open login window for ${url}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    },

    async close() {
      try {
        await page?.close()
      } catch {
        /* ignore */
      }
      try {
        await context?.close()
      } catch {
        /* ignore */
      }
      context = null
      page = null
    },
  }
}
