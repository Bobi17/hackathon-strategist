// ── useStrategistStream — React hook bridging the control room to the strategist ──
//
// Connects a WebSocket to the strategist server (/ws), accumulates the full event
// stream, and exposes derived views: the transcript feed, stage rail, per-round
// scores + verdicts, pending gates, and interject helpers.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  HumanDirective,
  PanelPersonaId,
  PersonaId,
  ReviewerVerdict,
  Score,
  Stage,
  StreamEvent,
} from '../../data/types'

export type RunStatus = 'idle' | 'starting' | 'running' | 'complete' | 'error'

export interface RoundState {
  number: number
  scores: Score[]
  verdicts: ReviewerVerdict[]
  debate: { persona: PersonaId; text: string; citations: string[] }[]
}

export type FeedItem =
  | { kind: 'run'; seq: number; ts: number; status: string; message?: string }
  | { kind: 'stage'; seq: number; ts: number; stage: Stage }
  | { kind: 'round'; seq: number; ts: number; number: number; action: 'start' | 'end' }
  | { kind: 'message'; seq: number; ts: number; round: number; persona: PersonaId; text: string; citations: string[] }
  | { kind: 'scores'; seq: number; ts: number; round: number; scores: Score[] }
  | { kind: 'verdict'; seq: number; ts: number; round: number; verdict: ReviewerVerdict }
  | { kind: 'directive'; seq: number; ts: number; directive: HumanDirective; accepted: boolean }
  | { kind: 'gate'; seq: number; ts: number; gate: string; decision: string }

export interface StrategistState {
  connected: boolean
  eventCount: number
  runStatus: RunStatus
  /** True when this control room accepts event configs from the UI (interactive mode). */
  acceptsRuns: boolean
  stages: Stage[]
  feed: FeedItem[]
  rounds: RoundState[]
  activeGate: { gate: string } | null
  directives: HumanDirective[]
  latestScores: Score[]
  error: string | null
}

const STAGE_ORDER: Stage[] = ['ingest', 'research', 'synthesize', 'ideate', 'loop', 'finalize', 'artifacts']

function toFeedItem(evt: StreamEvent): FeedItem | null {
  const e = evt.event
  switch (e.kind) {
    case 'run': return { kind: 'run', seq: evt.seq, ts: evt.ts, status: e.status, message: e.message }
    case 'stage': return { kind: 'stage', seq: evt.seq, ts: evt.ts, stage: e.stage }
    case 'round': return { kind: 'round', seq: evt.seq, ts: evt.ts, number: e.number, action: e.action }
    case 'message': return { kind: 'message', seq: evt.seq, ts: evt.ts, round: e.round, persona: e.persona, text: e.text, citations: e.citations }
    case 'score': return { kind: 'scores', seq: evt.seq, ts: evt.ts, round: e.round, scores: e.scores }
    case 'verdict': return { kind: 'verdict', seq: evt.seq, ts: evt.ts, round: e.round, verdict: e.verdict }
    case 'directive': return { kind: 'directive', seq: evt.seq, ts: evt.ts, directive: e.directive, accepted: e.accepted }
    case 'gate': return { kind: 'gate', seq: evt.seq, ts: evt.ts, gate: e.gate, decision: e.decision }
    default: return null
  }
}

export function useStrategistStream(wsUrl?: string): StrategistState & {
  interject: (persona: PanelPersonaId | 'all', message: string) => void
  resolveGate: (gate: string, decision: 'approved' | 'rejected') => void
  launchRun: (config: unknown) => Promise<{ ok: boolean; errors?: { field: string; message: string }[] }>
} {
  const [events, setEvents] = useState<StreamEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [acceptsRuns, setAcceptsRuns] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const urlRef = useRef(wsUrl ?? '')

  // Does this control room accept configs from the browser (interactive mode)?
  // In immediate mode (server started with --config) it never shows the launch
  // form, even before the first run event arrives.
  useEffect(() => {
    fetch('/api/status')
      .then((r) => r.json())
      .then((d) => { if (d && typeof d.acceptsRuns === 'boolean') setAcceptsRuns(d.acceptsRuns) })
      .catch(() => { /* server may be mid-restart — stay conservative (no form) */ })
  }, [])

  useEffect(() => {
    const url = urlRef.current
      || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
    let ws: WebSocket | null = null
    let closed = false
    let retry = 0

    const connect = () => {
      if (closed) return
      ws = new WebSocket(url)
      wsRef.current = ws
      ws.onopen = () => { retry = 0; setConnected(true); setError(null) }
      ws.onmessage = (raw) => {
        try {
          const msg = JSON.parse(String(raw.data))
          if (msg && typeof msg === 'object' && 'seq' in msg && 'event' in msg) {
            const evt = msg as StreamEvent
            setEvents((prev) => {
              // A fresh run/starting after prior events → start a new transcript
              // (UI re-launch). On a fresh connect prev is empty, so the replay
              // of an already-started run is unaffected.
              if (evt.event.kind === 'run' && evt.event.status === 'starting' && prev.length > 0) return [evt]
              return prev.some((e) => e.seq === evt.seq) ? prev : [...prev, evt]
            })
          }
        } catch {
          // ignore non-JSON frames (hello/pong)
        }
      }
      ws.onclose = () => {
        setConnected(false)
        if (!closed) {
          retry++
          const delay = Math.min(1500 * retry, 8000)
          setTimeout(connect, delay)
        }
      }
      ws.onerror = () => {
        setError('WebSocket error — is the strategist run active?')
        ws?.close()
      }
    }
    connect()
    return () => { closed = true; ws?.close() }
  }, [])

  const send = useCallback((msg: unknown) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }, [])

  const interject = useCallback((persona: PanelPersonaId | 'all', message: string) => {
    send({ type: 'interject', persona, message })
  }, [send])

  const resolveGate = useCallback((gate: string, decision: 'approved' | 'rejected') => {
    send({ type: 'gate', gate, decision })
  }, [send])

  /** Submit an EventConfig to the server and start a run (interactive mode). */
  const launchRun = useCallback(async (config: unknown): Promise<{
    ok: boolean
    errors?: { field: string; message: string }[]
  }> => {
    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) return { ok: true }
      return { ok: false, errors: (data as { errors?: { field: string; message: string }[] })?.errors }
    } catch {
      return { ok: false, errors: [{ field: 'network', message: 'Could not reach the strategist server.' }] }
    }
  }, [])

  const state = useMemo<StrategistState>(() => {
    const feed: FeedItem[] = []
    const rounds = new Map<number, RoundState>()
    const stages: Stage[] = []
    let runStatus: RunStatus = 'idle'
    const openGates = new Map<string, boolean>()
    const directives: HumanDirective[] = []
    let activeGate: { gate: string } | null = null

    for (const evt of events) {
      const item = toFeedItem(evt)
      if (!item) continue
      feed.push(item)

      switch (item.kind) {
        case 'run':
          runStatus = item.status as RunStatus
          break
        case 'stage':
          if (!stages.includes(item.stage)) stages.push(item.stage)
          break
        case 'round': {
          let r = rounds.get(item.number)
          if (!r) { r = { number: item.number, scores: [], verdicts: [], debate: [] }; rounds.set(item.number, r) }
          break
        }
        case 'message': {
          const r = rounds.get(item.round) ?? { number: item.round, scores: [], verdicts: [], debate: [] }
          r.debate = [...r.debate, { persona: item.persona, text: item.text, citations: item.citations }]
          rounds.set(item.round, r)
          break
        }
        case 'scores': {
          const r = rounds.get(item.round) ?? { number: item.round, scores: [], verdicts: [], debate: [] }
          r.scores = item.scores
          rounds.set(item.round, r)
          break
        }
        case 'verdict': {
          const r = rounds.get(item.round) ?? { number: item.round, scores: [], verdicts: [], debate: [] }
          r.verdicts = [...r.verdicts, item.verdict]
          rounds.set(item.round, r)
          break
        }
        case 'directive':
          directives.push(item.directive)
          break
        case 'gate': {
          if (item.decision === 'requested') {
            openGates.set(item.gate, true)
            activeGate = { gate: item.gate }
          } else {
            openGates.set(item.gate, false)
            if (activeGate?.gate === item.gate) activeGate = null
          }
          break
        }
      }
    }

    const sortedRounds = [...rounds.values()].sort((a, b) => a.number - b.number)
    const lastRound = sortedRounds[sortedRounds.length - 1]

    // activeGate: the newest gate still open (fall back to any open gate).
    if (!activeGate) {
      for (const [g, open] of openGates) if (open) { activeGate = { gate: g }; break }
    }

    return {
      connected,
      eventCount: events.length,
      runStatus,
      acceptsRuns,
      stages,
      feed,
      rounds: sortedRounds,
      activeGate,
      directives,
      latestScores: lastRound?.scores ?? [],
      error,
    }
  }, [events, connected, error, acceptsRuns])

  return { ...state, interject, resolveGate, launchRun }
}

export { STAGE_ORDER }
