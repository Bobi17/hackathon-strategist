// ── ControlRoomServer integration tests — WS streaming, interject, gates ──

import { describe, it, expect, afterEach } from 'vitest'
import WebSocket from 'ws'
import { globalBus } from '../engine/event-bus.js'
import { DirectiveBroker } from './broker.js'
import { ControlRoomServer, type ControlRoomOptions } from './server.js'
import type { LoopOutcome } from '../data/types.js'

type RunHandler = NonNullable<ControlRoomOptions['onRun']>

/** Capture the config passed to onRun and resolve with an empty result. */
function makeRunHandler(captured: unknown[]): RunHandler {
  return (async (cfg: unknown) => {
    captured.push(cfg)
    return { outcome: { status: 'escalated' } as LoopOutcome, artifactPaths: [] }
  }) as unknown as RunHandler
}

async function waitFor<T>(fn: () => T | undefined, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let last: T | undefined
  while (Date.now() < deadline) {
    last = fn()
    if (last) return last
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`)
}

type WireMsg = { type?: string; seq?: number; event?: { kind: string } & Record<string, unknown> }

function connect(port: number): Promise<{ ws: WebSocket; received: WireMsg[] }> {
  const ws = new WebSocket(`ws://localhost:${port}/ws`)
  const received: WireMsg[] = []
  ws.on('message', (raw) => received.push(JSON.parse(String(raw))))
  return new Promise((res) => ws.once('open', () => res({ ws, received })))
}

describe('ControlRoomServer', () => {
  const servers: ControlRoomServer[] = []

  afterEach(async () => {
    for (const s of servers) await s.close()
    servers.length = 0
    globalBus.reset()
  })

  function makeServer(opts?: Partial<ConstructorParameters<typeof ControlRoomServer>[0]>) {
    const server = new ControlRoomServer({ broker: new DirectiveBroker(), port: 0, gateTimeoutMs: 0, ...opts })
    servers.push(server)
    return server
  }

  it('replays past events and streams live ones to a WS client', async () => {
    const server = makeServer()
    await server.start()
    globalBus.emit({ kind: 'stage', stage: 'ingest', at: Date.now() })

    const { ws, received } = await connect(server.port)
    await waitFor(() => received.find((m) => m.event?.kind === 'stage'))
    expect(received.find((m) => m.event?.kind === 'stage')?.event?.stage).toBe('ingest')

    globalBus.emit({ kind: 'round', number: 1, action: 'start' })
    await waitFor(() => received.find((m) => m.event?.kind === 'round'))
    ws.close()
  })

  it('accepts interjections over WS and broadcasts a directive event', async () => {
    const server = makeServer()
    await server.start()
    const { ws, received } = await connect(server.port)

    ws.send(JSON.stringify({ type: 'interject', persona: 'judge', message: 'Prioritize demo polish' }))
    const evt = await waitFor(() => received.find((m) => m.event?.kind === 'directive'))
    expect(evt.event?.directive).toMatchObject({ message: 'Prioritize demo polish', target: 'judge' })
    expect(server.broker.pendingFor('judge')).toHaveLength(1)
    ws.close()
  })

  it('blocks on a gate until the client approves it', async () => {
    const server = makeServer() // autoResolveGates defaults to false
    await server.start()
    const { ws, received } = await connect(server.port)

    const gate = server.requestGate('approveWinner')
    await waitFor(() => received.find((m) => m.event?.kind === 'gate' && m.event?.decision === 'requested'))

    ws.send(JSON.stringify({ type: 'gate', gate: 'approveWinner', decision: 'approved' }))
    expect(await gate).toBe(true)
    await waitFor(() => received.find((m) => m.event?.kind === 'gate' && m.event?.decision === 'resolved'))
    ws.close()
  })

  it('resolves a rejected gate as false', async () => {
    const server = makeServer()
    await server.start()
    const { ws } = await connect(server.port)
    const gate = server.requestGate('approveWinner')
    ws.send(JSON.stringify({ type: 'gate', gate: 'approveWinner', decision: 'rejected' }))
    expect(await gate).toBe(false)
    ws.close()
  })

  it('auto-resolves gates in auto mode (headless)', async () => {
    const server = makeServer()
    server.autoResolveGates = true
    await server.start()
    expect(await server.requestGate('approveTop3')).toBe(true)
  })

  it('escalates a gate when the human does not respond in time', async () => {
    const server = makeServer({ gateTimeoutMs: 50 })
    await server.start()
    const { ws, received } = await connect(server.port)
    const gate = server.requestGate('approveTop3')
    expect(await gate).toBe(false)
    await waitFor(() => received.find((m) => m.event?.kind === 'gate' && m.event?.decision === 'escalated'))
    ws.close()
  })

  it('serves the built UI from dist (index.html)', async () => {
    const server = makeServer()
    await server.start()
    const res = await fetch(`http://localhost:${server.port}/`)
    expect(res.ok).toBe(true)
    const html = await res.text()
    expect(html).toContain('Hackathon Strategist')
  })
})

describe('ControlRoomServer API — interactive run start', () => {
  const servers: ControlRoomServer[] = []

  afterEach(async () => {
    for (const s of servers) await s.close()
    servers.length = 0
    globalBus.reset()
  })

  function makeServer(opts?: Partial<ControlRoomOptions>) {
    const server = new ControlRoomServer({ broker: new DirectiveBroker(), port: 0, gateTimeoutMs: 0, ...opts })
    servers.push(server)
    return server
  }

  const VALID_CONFIG = {
    slug: 'api-test',
    name: 'API Test Event',
    websiteUrls: ['https://api-test.dev'],
    problemStatements: ['Solve supply-chain visibility with AI.'],
    team: { size: 2, skills: ['typescript'] },
  }

  const post = (port: number, body: unknown) =>
    fetch(`http://localhost:${port}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('reports idle status + acceptsRuns=true in interactive mode', async () => {
    const server = makeServer({ onRun: makeRunHandler([]) })
    await server.start()
    const res = await fetch(`http://localhost:${server.port}/api/status`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'idle', acceptsRuns: true })
  })

  it('reports acceptsRuns=false without onRun and rejects POST with 501', async () => {
    const server = makeServer()
    await server.start()
    const status = await (await fetch(`http://localhost:${server.port}/api/status`)).json()
    expect(status.acceptsRuns).toBe(false)
    const res = await post(server.port, VALID_CONFIG)
    expect(res.status).toBe(501)
  })

  it('accepts a valid config and invokes onRun with the parsed config', async () => {
    const captured: unknown[] = []
    const server = makeServer({ onRun: makeRunHandler(captured) })
    await server.start()
    const res = await post(server.port, VALID_CONFIG)
    expect(res.status).toBe(202)
    expect((await res.json()).ok).toBe(true)
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({ name: 'API Test Event', slug: 'api-test' })
  })

  it('rejects an invalid config with 400 and field errors', async () => {
    const server = makeServer({ onRun: makeRunHandler([]) })
    await server.start()
    const res = await post(server.port, { name: 'No URLs' })
    expect(res.status).toBe(400)
    const data = (await res.json()) as { errors: { field: string }[] }
    expect(data.errors.map((e) => e.field)).toContain('websiteUrls')
  })

  it('rejects a second run while one is active with 409', async () => {
    const server = makeServer({ onRun: makeRunHandler([]) })
    await server.start()
    server.broadcastRun('starting', 'first')
    const res = await post(server.port, VALID_CONFIG)
    expect(res.status).toBe(409)
  })
})
