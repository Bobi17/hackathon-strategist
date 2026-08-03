// ── ControlRoomServer integration tests — WS streaming, interject, gates ──

import { describe, it, expect, afterEach } from 'vitest'
import WebSocket from 'ws'
import { globalBus } from '../engine/event-bus.js'
import { DirectiveBroker } from './broker.js'
import { ControlRoomServer } from './server.js'

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
