// ── fetchWithEscalation tests — plain fetch → browser → auth gate / paste ──

import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchWithEscalation, DEFAULT_MIN_CONTENT } from './fetch.js'
import type { EventConfig } from '../config/types.js'
import type { ControlRoomServer } from '../control-room/server.js'
import type { BrowserSession } from './browser.js'

function makeConfig(overrides: Partial<EventConfig> = {}): EventConfig {
  return {
    slug: 'test',
    name: 'Test',
    websiteUrls: [],
    problemStatements: ['p'],
    team: { size: 1, skills: [] },
    mode: 'headless',
    ...overrides,
  }
}

// A realistic rendered text string that passes the 300-char threshold.
const RENDERED_TEXT = 'The hackathon runs 48 hours, in person. ' + 'Teams of 3. '.repeat(40)

function makeSession(overrides: Partial<BrowserSession> = {}): BrowserSession {
  return {
    render: vi.fn(async () => RENDERED_TEXT),
    openForLogin: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    ...overrides,
  }
}

function makeServer(overrides: Partial<ControlRoomServer> = {}): ControlRoomServer {
  return {
    requestIngestAuth: vi.fn(async () => ({ kind: 'escalated' })),
    ...overrides,
  } as unknown as ControlRoomServer
}

/** Helper: set up global fetch with a canned response. */
function mockFetch(body: string, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok,
    text: async () => body,
  })))
}

// A realistic HTML string that normalizeHTML will collapse to ≥ DEFAULT_MIN_CONTENT chars.
const GOOD_HTML = '<div>' + 'The hackathon runs 48 hours, in person. '.repeat(20) + '</div>'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('fetchWithEscalation', () => {
  it('returns plain fetch when content is long enough', async () => {
    mockFetch(GOOD_HTML)
    const result = await fetchWithEscalation(makeConfig(), 'https://event.dev', { session: null, auto: true })
    expect(result.source).toBe('fetch')
    expect(result.content.length).toBeGreaterThan(DEFAULT_MIN_CONTENT)
  })

  it('escalates to browser when plain fetch returns thin content', async () => {
    const shortHtml = '<html><body><p>Sign in to continue.</p></body></html>'
    mockFetch(shortHtml)
    const session = makeSession()
    const result = await fetchWithEscalation(makeConfig(), 'https://gated.dev', { session, auto: true })
    expect(session.render).toHaveBeenCalledWith('https://gated.dev')
    expect(result.source).toBe('browser')
    expect(result.content.length).toBeGreaterThan(0)
  })

  it('falls back to failed when no session and content is thin', async () => {
    mockFetch('<html><body><p>thin</p></body></html>')
    const result = await fetchWithEscalation(makeConfig(), 'https://gated.dev', { session: null, auto: true })
    expect(result.source).toBe('failed')
    expect(result.content).toBe('')
  })

  it('returns pasted content when the human pastes it in interactive mode', async () => {
    mockFetch('<html><body><p>thin</p></body></html>')
    const session = makeSession({
      // Browser render returns null (login-walled) so we fall through to the auth gate.
      render: vi.fn(async () => null),
    })
    const server = makeServer({
      requestIngestAuth: vi.fn(async () => ({ kind: 'pasted', text: 'Here is the real content.' } as const)),
    })
    const result = await fetchWithEscalation(makeConfig(), 'https://gated.dev', { session, server, auto: false })
    expect(result.source).toBe('pasted')
    expect(result.content).toBe('Here is the real content.')
    expect(session.openForLogin).toHaveBeenCalledWith('https://gated.dev')
  })

  it('retries after the human signs in (browser re-renders)', async () => {
    mockFetch('<html><body><p>thin</p></body></html>')
    const renderFn = vi.fn()
      .mockResolvedValueOnce(null)        // first attempt: login-walled
      .mockResolvedValueOnce(RENDERED_TEXT) // retry after sign-in: usable content
    const session = makeSession({ render: renderFn })
    const server = makeServer({
      requestIngestAuth: vi.fn(async () => ({ kind: 'retry' } as const)),
    })
    const result = await fetchWithEscalation(makeConfig(), 'https://gated.dev', { session, server, auto: false })
    expect(result.source).toBe('browser')
    expect(renderFn).toHaveBeenCalledTimes(2)
  })

  it('returns fetched fallback when browser fails but plain fetch was usable', async () => {
    const session = makeSession({ render: vi.fn(async () => null) })
    // Plain fetch is usable (< MIN would cause escalation, but with useBrowser we skip fast-path)
    mockFetch(GOOD_HTML)
    const result = await fetchWithEscalation(
      makeConfig({ useBrowser: true }),
      'https://event.dev',
      { session, server: undefined, auto: true },
    )
    // useBrowser forces browser; browser fails; fall back to fetched content.
    expect(result.source).toBe('fetch')
    expect(result.content.length).toBeGreaterThan(DEFAULT_MIN_CONTENT)
  })

  it('uses plain fetch when content is long and useBrowser is not set', async () => {
    mockFetch(GOOD_HTML)
    const session = makeSession()
    const result = await fetchWithEscalation(makeConfig(), 'https://event.dev', { session, auto: true })
    // Fast path: plain fetch passes threshold → session.render is NOT called.
    expect(session.render).not.toHaveBeenCalled()
    expect(result.source).toBe('fetch')
  })
})
