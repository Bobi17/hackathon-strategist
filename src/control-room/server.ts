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
import { DirectiveBroker } from './broker.js'
import type { PanelPersonaId } from '../data/types.js'

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
}

interface PendingGate {
  resolve: (approved: boolean) => void
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
  /** Set by the orchestrator: when true, gates resolve instantly (headless). */
  autoResolveGates = false

  constructor(opts: ControlRoomOptions) {
    this.broker = opts.broker
    this.#bus = opts.bus ?? globalBus
    this.#distDir = opts.distDir ?? join(import.meta.dirname, '../../dist')
    this.#gateTimeoutMs = opts.gateTimeoutMs ?? 10 * 60_000
    this.#port = opts.port ?? Number(process.env.CONTROL_ROOM_PORT ?? 8787)

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

  // ── Run-level broadcast ──────────────────────────────────────────────────

  /** Emit a run-status event on the bus (also streams to all clients). */
  broadcastRun(status: 'starting' | 'running' | 'complete' | 'error', message?: string): void {
    this.#bus.emit({ kind: 'run', status, message })
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
      const pending: PendingGate = { resolve }
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

  /** Resolve a gate from a WS message. Returns false if no gate is pending. */
  #resolveGate(gate: string, approved: boolean): boolean {
    const pending = this.#pendingGates.get(gate)
    if (!pending) return false
    this.#pendingGates.delete(gate)
    if (pending.timer) clearTimeout(pending.timer)
    this.#bus.emit({ kind: 'gate', gate, decision: 'resolved' })
    pending.resolve(approved)
    return true
  }

  // ── HTTP ─────────────────────────────────────────────────────────────────

  async #handleHttp(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const pathname = decodeURIComponent(url.pathname)
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
        const resolved = this.#resolveGate(msg.gate, msg.decision === 'approved')
        ws.send(JSON.stringify({ type: 'gate-result', gate: msg.gate, ok: resolved, ts: Date.now() }))
        return
      }
    }
  }
}

type ClientMessage =
  | { type: 'ping' }
  | { type: 'interject'; persona?: PanelPersonaId | 'all'; message: string }
  | { type: 'gate'; gate: string; decision: 'approved' | 'rejected' }

/** Convenience: build a server wired to the global bus + a fresh broker. */
export function createControlRoom(opts?: Partial<ControlRoomOptions>): ControlRoomServer {
  const broker = opts?.broker ?? new DirectiveBroker()
  return new ControlRoomServer({ broker, ...opts })
}
