// ── Control-Room Server — HTTP (static UI) + WebSocket (live run stream) ───
//
// In `--ui` mode the orchestrator starts this server BEFORE the run begins:
//   - HTTP serves the built React control room (from `dist/`) so you can open
//     http://localhost:<port> in a browser and watch the run live.
//   - WS at /ws replays the full event bus on connect, then streams new events.
//   - Clients can interject (send a directive to a reviewer persona) and
//     resolve gates (approve the Top-3 / winner checkpoints).
//
// The run itself lives in the same process; the server is a pure observer +
// control surface over the shared event bus.

import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, normalize, extname } from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import { globalBus, type EventBus } from '../engine/event-bus.js'
import { validateConfig } from '../config/schema.js'
import type { EventConfig } from '../config/types.js'
import type { RunResult } from '../engine/orchestrator.js'
import { DirectiveBroker } from './broker.js'
import type { IdeaCard, IngestAuthResolution, PanelPersonaId, PickWinnerResolution } from '../data/types.js'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
}

export interface ControlRoomOptions {
  port?: number
  distDir?: string
  broker: DirectiveBroker
  bus?: EventBus
  /** How long a human gate stays open before auto-escalating (ms). 0 = forever. */
  gateTimeoutMs?: number
  /**
   * Interactive mode: when present, the server accepts POST /api/run and
   * invokes this handler with the validated EventConfig to start a run.
   */
  onRun?: (config: EventConfig) => Promise<RunResult>
}

export type RunStatus = 'idle' | 'starting' | 'running' | 'complete' | 'error'

type GateValue = boolean | PickWinnerResolution | IngestAuthResolution

interface PendingGate {
  /** Boolean gates resolve `true/false`; pick-winner and ingest-auth resolve richer results. */
  resolve: (value: GateValue) => void
  timer?: ReturnType<typeof setTimeout>
}

export class ControlRoomServer {
  readonly broker: DirectiveBroker
  #bus: EventBus
  #http: Server
  #wss: WebSocketServer
  #distDir: string
  #gateTimeoutMs: number
  #pendingGates = new Map<string, PendingGate>()
  #port: number
  #started = false
  #onRun?: (config: EventConfig) => Promise<RunResult>
  #runStatus: RunStatus = 'idle'
  /** Set by the orchestrator: when true, gates resolve instantly (headless). */
  autoResolveGates = false

  constructor(opts: ControlRoomOptions) {
    this.broker = opts.broker
    this.#bus = opts.bus ?? globalBus
    this.#distDir = opts.distDir ?? join(import.meta.dirname, '../../dist')
    this.#gateTimeoutMs = opts.gateTimeoutMs ?? 10 * 60_000
    this.#port = opts.port ?? Number(process.env.CONTROL_ROOM_PORT ?? 8787)
    this.#onRun = opts.onRun

    // Mirror the run status from the bus so /api/status always reflects the
    // live run (and POST /api/run can guard against concurrent starts).
    this.#bus.subscribe((evt) => {
      if (evt.event.kind === 'run') this.#runStatus = evt.event.status
    })

    this.#http = createServer((req, res) => this.#handleHttp(req, res))
    this.#wss = new WebSocketServer({ noServer: true })

    this.#http.on('upgrade', (req, socket, head) => {
      const { pathname } = new URL(req.url ?? '/', 'http://localhost')
      if (pathname === '/ws') {
        this.#wss.handleUpgrade(req, socket, head, (ws) => this.#handleSocket(ws))
      } else {
        socket.destroy()
      }
    })
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.#http.once('error', reject)
      this.#http.listen(this.#port, () => {
        this.#http.removeListener('error', reject)
        // Reflect the actual bound port (matters when port: 0 / ephemeral).
        const addr = this.#http.address()
        if (addr && typeof addr === 'object') this.#port = addr.port
        resolve()
      })
    })
    this.#started = true
  }

  async close(): Promise<void> {
    if (!this.#started) return
    for (const ws of this.#wss.clients) ws.close()
    this.#wss.close()
    await new Promise<void>((resolve) => this.#http.close(() => resolve()))
    this.#started = false
  }

  get port(): number {
    return this.#port
  }

  /** Current run lifecycle status (mirrored from the event bus). */
  get runStatus(): RunStatus {
    return this.#runStatus
  }

  // ── Run-level broadcast ──────────────────────────────────────────────────

  /** Emit a run-status event on the bus (also streams to all clients). */
  broadcastRun(status: 'starting' | 'running' | 'complete' | 'error', message?: string): void {
    this.#bus.emit({ kind: 'run', status, message })
  }

  // ── Interactive start (config fed from the UI) ───────────────────────────

  /** POST /api/run — validate the submitted EventConfig and start a run. */
  async #handleStartRun(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<void> {
    if (!this.#onRun) {
      this.#sendJson(res, 501, {
        error: 'This control room does not accept runs from the UI. Start it without --config: pnpm strategist:run --ui',
      })
      return
    }
    if (this.#runStatus !== 'idle') {
      this.#sendJson(res, 409, { error: `A run is already ${this.#runStatus}.` })
      return
    }

    let raw: unknown
    try {
      const body = await readBody(req)
      raw = JSON.parse(body)
    } catch {
      this.#sendJson(res, 400, { errors: [{ field: 'body', message: 'Request body must be valid JSON.' }] })
      return
    }

    const errors = validateConfig(raw as Record<string, unknown>)
    if (errors.length > 0) {
      this.#sendJson(res, 400, { errors })
      return
    }

    this.#runStatus = 'starting'
    const config = raw as EventConfig
    this.#onRun(config).catch((err: unknown) => {
      console.error('❌  UI-triggered run failed:', err)
      this.broadcastRun('error', err instanceof Error ? err.message : String(err))
    })
    this.#sendJson(res, 202, { ok: true, eventName: config.name })
  }

  #sendJson(res: import('node:http').ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(data))
  }

  // ── Gates ────────────────────────────────────────────────────────────────

  /**
   * Announce a gate checkpoint. In auto mode (headless / continue-without-
   * pause) it resolves immediately; otherwise it blocks until the control room
   * resolves it (or the timeout escalates it). Returns whether the gate passed.
   */
  async requestGate(gate: string, payload?: Record<string, unknown>): Promise<boolean> {
    if (payload) this.#bus.emit({ kind: 'message', round: 0, persona: 'orchestrator', text: `Gate requested: ${gate}`, citations: [] })
    this.#bus.emit({ kind: 'gate', gate, decision: 'requested' })

    if (this.autoResolveGates) {
      this.#bus.emit({ kind: 'gate', gate, decision: 'resolved' })
      return true
    }

    return new Promise<boolean>((resolve) => {
      const pending: PendingGate = { resolve: (value) => resolve(value === true) }
      if (this.#gateTimeoutMs > 0) {
        pending.timer = setTimeout(() => {
          this.#pendingGates.delete(gate)
          this.#bus.emit({ kind: 'gate', gate, decision: 'escalated' })
          resolve(false)
        }, this.#gateTimeoutMs)
      }
      this.#pendingGates.set(gate, pending)
    })
  }

  /**
   * Present the Top 3 for a pick-or-feedback decision. In auto mode (headless /
   * continue-without-pause) it auto-picks the top-ranked idea; otherwise it
   * blocks until the human picks one, sends feedback to refine the ideas, or
   * the timeout escalates.
   */
  async requestPickWinner(top3: IdeaCard[]): Promise<PickWinnerResolution> {
    this.#bus.emit({ kind: 'message', round: 0, persona: 'orchestrator', text: 'Top 3 ready — pick a winner or send feedback to refine.', citations: [] })
    this.#bus.emit({ kind: 'gate', gate: 'pickWinner', decision: 'requested', payload: { top3 } })

    if (this.autoResolveGates) {
      this.#bus.emit({ kind: 'gate', gate: 'pickWinner', decision: 'resolved' })
      return { kind: 'picked', ideaId: top3[0]?.id ?? '' }
    }

    return new Promise<PickWinnerResolution>((resolve) => {
      const pending: PendingGate = {
        resolve: (value) =>
          resolve(typeof value === 'boolean' ? { kind: 'escalated' } : (value as PickWinnerResolution)),
      }
      if (this.#gateTimeoutMs > 0) {
        pending.timer = setTimeout(() => {
          this.#pendingGates.delete('pickWinner')
          this.#bus.emit({ kind: 'gate', gate: 'pickWinner', decision: 'escalated' })
          resolve({ kind: 'escalated' })
        }, this.#gateTimeoutMs)
      }
      this.#pendingGates.set('pickWinner', pending)
    })
  }

  /**
   * Present a login-gated URL to the human. In auto mode (headless /
   * continue-without-pause) it resolves instantly to `{ kind: 'escalated' }`;
   * otherwise it blocks until the human signals they've signed in (retry —
   * the orchestrator re-renders with the logged-in session), pastes the page
   * content, or the timeout escalates.
   */
  async requestIngestAuth(url: string): Promise<IngestAuthResolution> {
    this.#bus.emit({
      kind: 'message', round: 0, persona: 'orchestrator',
      text: `A page needs your sign-in to fetch: ${url}`, citations: [],
    })
    this.#bus.emit({ kind: 'gate', gate: 'ingest-auth', decision: 'requested', payload: { url } })

    if (this.autoResolveGates) {
      this.#bus.emit({ kind: 'gate', gate: 'ingest-auth', decision: 'resolved' })
      return { kind: 'escalated' }
    }

    return new Promise<IngestAuthResolution>((resolve) => {
      const pending: PendingGate = {
        resolve: (value) =>
          resolve(typeof value === 'boolean' ? { kind: 'escalated' } : (value as IngestAuthResolution)),
      }
      if (this.#gateTimeoutMs > 0) {
        pending.timer = setTimeout(() => {
          this.#pendingGates.delete('ingest-auth')
          this.#bus.emit({ kind: 'gate', gate: 'ingest-auth', decision: 'escalated' })
          resolve({ kind: 'escalated' })
        }, this.#gateTimeoutMs)
      }
      this.#pendingGates.set('ingest-auth', pending)
    })
  }

  /** Resolve a gate from a WS message. Returns false if no gate is pending. */
  #resolveGate(msg: { gate: string; decision: string; pick?: string; message?: string }): boolean {
    const pending = this.#pendingGates.get(msg.gate)
    if (!pending) return false
    this.#pendingGates.delete(msg.gate)
    if (pending.timer) clearTimeout(pending.timer)

    // The ingest-auth gate: human signed in (re-render) or pasted content.
    if (msg.gate === 'ingest-auth') {
      if (msg.decision === 'retry') {
        this.#bus.emit({ kind: 'gate', gate: msg.gate, decision: 'retry' })
        pending.resolve({ kind: 'retry' })
      } else if (msg.decision === 'pasted' && msg.message) {
        this.#bus.emit({ kind: 'gate', gate: msg.gate, decision: 'pasted', message: msg.message })
        pending.resolve({ kind: 'pasted', text: msg.message })
      } else {
        // Malformed ingest-auth message → escalate so the run never deadlocks.
        this.#bus.emit({ kind: 'gate', gate: msg.gate, decision: 'escalated' })
        pending.resolve({ kind: 'escalated' })
      }
      return true
    }

    // The pick-winner gate resolves to a richer result than approve/reject.
    if (msg.gate === 'pickWinner') {
      if (msg.decision === 'picked' && msg.pick) {
        this.#bus.emit({ kind: 'gate', gate: msg.gate, decision: 'picked' })
        pending.resolve({ kind: 'picked', ideaId: msg.pick })
      } else if (msg.decision === 'feedback' && msg.message) {
        this.#bus.emit({ kind: 'gate', gate: msg.gate, decision: 'feedback', message: msg.message })
        pending.resolve({ kind: 'feedback', message: msg.message })
      } else {
        // Malformed pick-winner message → escalate so the run never deadlocks.
        this.#bus.emit({ kind: 'gate', gate: msg.gate, decision: 'escalated' })
        pending.resolve({ kind: 'escalated' })
      }
      return true
    }

    this.#bus.emit({ kind: 'gate', gate: msg.gate, decision: 'resolved' })
    pending.resolve(msg.decision === 'approved')
    return true
  }

  // ── HTTP ─────────────────────────────────────────────────────────────────

  async #handleHttp(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const pathname = decodeURIComponent(url.pathname)

    // ── API ────────────────────────────────────────────────────────────
    if (pathname === '/api/status' && req.method === 'GET') {
      this.#sendJson(res, 200, { status: this.#runStatus, acceptsRuns: this.#onRun !== undefined })
      return
    }
    if (pathname === '/api/run' && req.method === 'POST') {
      await this.#handleStartRun(req, res)
      return
    }

    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')

    // Guard against path traversal — only serve inside distDir.
    const file = normalize(join(this.#distDir, rel))
    if (!file.startsWith(normalize(this.#distDir))) {
      res.writeHead(403).end('Forbidden')
      return
    }

    try {
      const body = await readFile(file)
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      // SPA fallback for client routes → index.html (if present).
      try {
        const idx = await readFile(join(this.#distDir, 'index.html'))
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(idx)
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end(
          'Control-room UI not built.\n' +
          'Run `pnpm build` first, then `pnpm strategist:run --config <path> --ui`.\n',
        )
      }
    }
  }

  // ── WebSocket ────────────────────────────────────────────────────────────

  #handleSocket(ws: WebSocket): void {
    // Handshake first, then replay the whole bus so late joiners see context.
    ws.send(JSON.stringify({ type: 'hello', port: this.#port, ts: Date.now() }))
    this.#bus.replayTo((evt) => ws.send(JSON.stringify(evt)))

    const unsubscribe = this.#bus.subscribe((evt) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(evt))
    })

    ws.on('message', (raw) => {
      let msg: unknown
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }
      this.#handleClientMessage(ws, msg as ClientMessage)
    })

    ws.on('close', unsubscribe)
  }

  #handleClientMessage(ws: WebSocket, msg: ClientMessage): void {
    switch (msg.type) {
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }))
        return
      case 'interject': {
        const persona = msg.persona ?? 'all'
        const directive = this.broker.add(persona, msg.message)
        this.#bus.emit({ kind: 'directive', directive, accepted: true })
        return
      }
      case 'gate': {
        const resolved = this.#resolveGate(msg)
        ws.send(JSON.stringify({ type: 'gate-result', gate: msg.gate, ok: resolved, ts: Date.now() }))
        return
      }
    }
  }
}

type ClientMessage =
  | { type: 'ping' }
  | { type: 'interject'; persona?: PanelPersonaId | 'all'; message: string }
  | { type: 'gate'; gate: string; decision: 'approved' | 'rejected' | 'picked' | 'feedback' | 'retry' | 'pasted'; pick?: string; message?: string }

/** Convenience: build a server wired to the global bus + a fresh broker. */
export function createControlRoom(opts?: Partial<ControlRoomOptions>): ControlRoomServer {
  const broker = opts?.broker ?? new DirectiveBroker()
  return new ControlRoomServer({ broker, ...opts })
}

/** Buffer the request body as a string (small JSON payloads). */
function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}
