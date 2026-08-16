// ── Control-room components — stage rail, transcript, score board, gates ──

import { useState, type ReactNode } from 'react'
import type { GatePayload, IdeaCard, PanelPersonaId, PersonaId, ReviewerVerdict, Score } from '../../data/types'
import { personaMeta } from './meta'
import type { FeedItem, RoundState } from './useStrategistStream'
import { STAGE_ORDER } from './useStrategistStream'

const CRITERIA: (keyof Score['criteria'])[] = [
  'problemFit', 'feasibility', 'innovation', 'stakeholderAlignment', 'dataLeverage', 'demoAbility',
]

const CRITERIA_LABEL: Record<string, string> = {
  problemFit: 'Problem fit', feasibility: 'Feasibility', innovation: 'Innovation',
  stakeholderAlignment: 'Stakeholder', dataLeverage: 'Data', demoAbility: 'Demo',
}

// ── Stage rail ─────────────────────────────────────────────────────────────

export function StageRail({ done }: { done: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {STAGE_ORDER.map((s) => {
        const isDone = done.includes(s)
        const isNext = !isDone && done.length === STAGE_ORDER.indexOf(s)
        return (
          <span
            key={s}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
              isDone
                ? 'bg-emerald-900/40 text-emerald-200 border-emerald-700/60'
                : isNext
                  ? 'bg-zinc-800 text-zinc-200 border-zinc-600 animate-pulse'
                  : 'bg-zinc-900 text-zinc-600 border-zinc-800'
            }`}
          >
            {isDone ? '✓ ' : ''}{s}
          </span>
        )
      })}
    </div>
  )
}

// ── Transcript ─────────────────────────────────────────────────────────────

function renderInline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={i} className="text-zinc-100 font-semibold">{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>,
  )
}

function GateBadge({ gate, decision }: { gate: string; decision: string }) {
  const colors: Record<string, string> = {
    requested: 'bg-yellow-900/50 text-yellow-200 border-yellow-600',
    resolved: 'bg-emerald-900/50 text-emerald-200 border-emerald-600',
    escalated: 'bg-red-900/50 text-red-200 border-red-600',
  }
  return (
    <div className={`border rounded-lg px-3 py-2 text-xs font-mono ${colors[decision] ?? 'bg-zinc-800'}`}>
      🚦 gate <b>{gate}</b> — {decision}
    </div>
  )
}

export function Transcript({ feed }: { feed: FeedItem[] }) {
  if (feed.length === 0) {
    return <div className="text-sm text-zinc-600 italic py-8 text-center">Waiting for the strategist to emit events…</div>
  }
  return (
    <div className="space-y-1.5">
      {feed.map((item) => {
        switch (item.kind) {
          case 'run':
            return (
              <div key={item.seq} className="text-center text-xs text-zinc-500 py-1">
                — run {item.status}{item.message ? ` · ${item.message}` : ''} —
              </div>
            )
          case 'stage':
            return (
              <div key={item.seq} className="text-center text-xs font-mono text-emerald-400 py-1">
                ▸ stage: {item.stage}
              </div>
            )
          case 'round':
            return (
              <div key={item.seq} className="text-center text-xs font-mono text-blue-400 py-1">
                ⚔ round {item.number} — {item.action}
              </div>
            )
          case 'message': {
            const meta = personaMeta(item.persona)
            return (
              <div key={item.seq} className="flex gap-2 items-start">
                <span className={`shrink-0 mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${meta.chip}`}>
                  {meta.emoji} {meta.label}
                </span>
                <div className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">
                  {renderInline(item.text)}
                </div>
              </div>
            )
          }
          case 'scores':
            return (
              <div key={item.seq} className="text-xs text-zinc-500 pl-2">
                📊 round {item.round} scored {item.scores.length} candidates — top: {item.scores[0]?.ideaId} ({item.scores[0]?.total.toFixed(2)})
              </div>
            )
          case 'verdict': {
            const v = item.verdict
            const ok = v.verdict === 'approve'
            return (
              <div key={item.seq} className={`text-xs pl-2 ${ok ? 'text-emerald-400' : 'text-red-400'}`}>
                {ok ? '✅' : '🔄'} {personaMeta(v.reviewer).label}: <b>{v.verdict}</b>
                {v.feedback.length > 0 ? ` — ${v.feedback.map((f) => f.topic).join(', ')}` : ''}
              </div>
            )
          }
          case 'directive':
            return (
              <div key={item.seq} className="text-xs pl-2 text-yellow-300">
                📣 directive → {item.directive.target}: “{item.directive.message}”
              </div>
            )
          case 'gate':
            return <div key={item.seq} className="pl-2"><GateBadge gate={item.gate} decision={item.decision} /></div>
          default:
            return null
        }
      })}
    </div>
  )
}

// ── Score board ────────────────────────────────────────────────────────────

export function ScoreBoard({ round }: { round?: RoundState }) {
  if (!round || round.scores.length === 0) {
    return <div className="text-sm text-zinc-600 italic py-6 text-center">No scores yet.</div>
  }
  const scores = [...round.scores].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500">
          <th className="py-1 pr-2">Rank</th>
          <th className="py-1 pr-2">Idea</th>
          {CRITERIA.map((c) => (
            <th key={c} className="py-1 px-1 text-right">{CRITERIA_LABEL[c]}</th>
          ))}
          <th className="py-1 pl-2 text-right">Total</th>
        </tr>
      </thead>
      <tbody>
        {scores.map((s) => (
          <tr key={s.ideaId} className="border-t border-zinc-800">
            <td className="py-1 pr-2 font-mono text-zinc-500">{s.rank}</td>
            <td className="py-1 pr-2 font-medium">{s.ideaId}</td>
            {CRITERIA.map((c) => (
              <td key={c} className="py-1 px-1 text-right text-zinc-400">{s.criteria[c]}</td>
            ))}
            <td className="py-1 pl-2 text-right font-semibold text-emerald-300">{s.total.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Verdicts ───────────────────────────────────────────────────────────────

export function VerdictPanel({ round }: { round?: RoundState }) {
  if (!round || round.verdicts.length === 0) {
    return <div className="text-sm text-zinc-600 italic py-4 text-center">Awaiting reviewer verdicts…</div>
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      {round.verdicts.map((v: ReviewerVerdict) => {
        const ok = v.verdict === 'approve'
        const meta = personaMeta(v.reviewer)
        return (
          <div key={v.reviewer} className={`rounded-lg border p-2.5 ${ok ? 'border-emerald-800 bg-emerald-950/30' : 'border-red-800 bg-red-950/30'}`}>
            <div className="text-xs font-semibold flex items-center gap-1.5">
              <span>{meta.emoji}</span>{meta.label}
              <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded ${ok ? 'bg-emerald-700 text-emerald-50' : 'bg-red-700 text-red-50'}`}>
                {v.verdict}
              </span>
            </div>
            {v.feedback.length > 0 && (
              <ul className="mt-1.5 space-y-1 text-[11px] text-zinc-400">
                {v.feedback.slice(0, 3).map((f, i) => (
                  <li key={i}>• <b className="text-zinc-300">{f.topic}</b>: {f.issue}</li>
                ))}
                {v.feedback.length > 3 && <li className="text-zinc-600">…+{v.feedback.length - 3} more</li>}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Gates ──────────────────────────────────────────────────────────────────

const clamp = (s: string | undefined, max: number): string => {
  const t = (s ?? '').trim()
  if (!t) return ''
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/** Pick-winner checkpoint: present the Top 3 and let the human pick one or send feedback to refine. */
function PickWinnerControls({
  top3,
  onPick,
  onFeedback,
}: {
  top3: IdeaCard[]
  onPick: (ideaId: string) => void
  onFeedback: (message: string) => void
}) {
  const [feedback, setFeedback] = useState('')

  const send = () => {
    const m = feedback.trim()
    if (!m) return
    onFeedback(m)
    setFeedback('')
  }

  if (top3.length === 0) {
    return <div className="text-sm text-zinc-600 italic py-3 text-center">No ideas to present yet.</div>
  }

  return (
    <div className="rounded-xl border border-cyan-800 bg-cyan-950/20 p-4">
      <div className="text-sm font-semibold text-cyan-200 mb-1">🎯 Pick the winner</div>
      <p className="text-xs text-zinc-400 mb-3">
        The Top 3 are finalized. Pick one as the winner, or send feedback to rewrite these ideas and re-deliberate.
      </p>

      <div className="space-y-3">
        {top3.map((idea, i) => (
          <div key={idea.id} className="rounded-lg border border-zinc-700 bg-zinc-900/60 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="px-1.5 py-0.5 rounded bg-cyan-900/60 text-cyan-200 text-[10px] font-bold">#{i + 1}</span>
                  <span className="text-xs font-mono text-zinc-500">{idea.id}</span>
                </div>
                <p className="text-sm font-semibold text-zinc-100 mt-1">{idea.oneLinePitch}</p>
              </div>
              <button
                onClick={() => onPick(idea.id)}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-medium transition-colors"
              >
                ★ Pick
              </button>
            </div>
            {clamp(idea.differentiator, 140) && (
              <p className="text-xs text-zinc-400 mt-2"><span className="text-zinc-500">Differentiator:</span> {clamp(idea.differentiator, 140)}</p>
            )}
            {clamp(idea.dataLeverage, 140) && (
              <p className="text-xs text-zinc-400 mt-1"><span className="text-zinc-500">Data:</span> {clamp(idea.dataLeverage, 140)}</p>
            )}
            {clamp(idea.buildScope, 140) && (
              <p className="text-xs text-zinc-400 mt-1"><span className="text-zinc-500">Scope:</span> {clamp(idea.buildScope, 140)}</p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-3 border-t border-zinc-800 pt-3">
        <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">
          Not happy with any? Send feedback to refine
        </label>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={3}
          placeholder="e.g. focus more on the data advantage, cut the dashboard scope, make the demo more personal…"
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-cyan-500"
        />
        <button
          onClick={send}
          disabled={!feedback.trim()}
          className="mt-2 px-3 py-1.5 rounded-lg bg-cyan-800 hover:bg-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
        >
          Send feedback &amp; refine
        </button>
      </div>
    </div>
  )
}

/** Ingest-auth checkpoint: a page needs the human to sign in, or paste its content. */
function AuthGatePanel({
  url,
  onRetry,
  onPaste,
}: {
  url?: string
  onRetry?: () => void
  onPaste?: (text: string) => void
}) {
  const [content, setContent] = useState('')
  const [pasted, setPasted] = useState(false)

  const sendPaste = () => {
    const t = content.trim()
    if (!t || !onPaste) return
    onPaste(t)
    setContent('')
    setPasted(true)
  }

  return (
    <div className="rounded-xl border border-purple-800 bg-purple-950/20 p-4">
      <div className="text-sm font-semibold text-purple-200 mb-1">🔐 Login required</div>
      {url && (
        <p className="text-xs text-zinc-400 mb-2 font-mono break-all truncate max-w-full">{url}</p>
      )}
      <p className="text-xs text-zinc-400 mb-3">
        A browser window is open — sign in, then click <strong>I've signed in</strong> to continue.
      </p>
      <button
        onClick={onRetry}
        className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-medium transition-colors"
      >
        ✓ I've signed in — continue
      </button>

      {pasted && (
        <p className="text-xs text-emerald-400 mt-2">Content received — continuing…</p>
      )}

      <div className="mt-3 border-t border-purple-900/50 pt-3">
        <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">
          …or paste the page content
        </label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          placeholder="Open the page in your browser, select all, copy, and paste the text here."
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500"
        />
        <button
          onClick={sendPaste}
          disabled={!content.trim()}
          className="mt-2 px-3 py-1.5 rounded-lg bg-purple-800 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
        >
          Send content
        </button>
      </div>
    </div>
  )
}

export function GateControls({
  activeGate,
  onResolve,
  onPick,
  onFeedback,
  onIngestRetry,
  onIngestPaste,
}: {
  activeGate: { gate: string; payload?: GatePayload } | null
  onResolve: (gate: string, decision: 'approved' | 'rejected') => void
  onPick: (ideaId: string) => void
  onFeedback: (message: string) => void
  onIngestRetry?: () => void
  onIngestPaste?: (text: string) => void
}) {
  if (!activeGate) {
    return <div className="text-sm text-zinc-600 italic py-3 text-center">No open gates.</div>
  }

  if (activeGate.gate === 'pickWinner') {
    return (
      <PickWinnerControls
        top3={activeGate.payload?.top3 ?? []}
        onPick={onPick}
        onFeedback={onFeedback}
      />
    )
  }

  if (activeGate.gate === 'ingest-auth') {
    return (
      <AuthGatePanel
        url={activeGate.payload?.url}
        onRetry={onIngestRetry}
        onPaste={onIngestPaste}
      />
    )
  }

  return (
    <div className="rounded-xl border border-yellow-800 bg-yellow-950/20 p-4">
      <div className="text-sm font-semibold text-yellow-200 mb-1">🚦 Gate: {activeGate.gate}</div>
      <p className="text-xs text-zinc-400 mb-3">
        The strategist is holding for your approval. Approve to continue, or reject to veto and escalate.
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => onResolve(activeGate.gate, 'approved')}
          className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-medium transition-colors"
        >
          ✓ Approve
        </button>
        <button
          onClick={() => onResolve(activeGate.gate, 'rejected')}
          className="px-3 py-1.5 rounded-lg bg-red-800/70 hover:bg-red-700 text-red-100 text-sm font-medium transition-colors"
        >
          ✕ Reject
        </button>
      </div>
    </div>
  )
}

// ── Interject ──────────────────────────────────────────────────────────────

const TARGETS: (PanelPersonaId | 'all')[] = ['all', 'judge', 'sponsor-reviewer', 'audience-reviewer', 'build-feasibility-reviewer']

export function Interject({
  onInterject,
  disabled,
}: {
  onInterject: (persona: PanelPersonaId | 'all', message: string) => void
  disabled?: boolean
}) {
  const [persona, setPersona] = useState<PanelPersonaId | 'all'>('all')
  const [message, setMessage] = useState('')

  const send = () => {
    const m = message.trim()
    if (!m) return
    onInterject(persona, m)
    setMessage('')
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="text-sm font-semibold text-zinc-200 mb-2">📣 Interject (injects into next review round)</div>
      <div className="flex flex-col gap-2">
        <select
          value={persona}
          onChange={(e) => setPersona(e.target.value as PanelPersonaId | 'all')}
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-sm text-zinc-200"
        >
          {TARGETS.map((t) => (
            <option key={t} value={t}>{t === 'all' ? 'All reviewers' : personaMeta(t as PersonaId).label}</option>
          ))}
        </select>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="e.g. The demo must work offline — prioritize first-paint speed over depth."
          rows={2}
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-2 text-sm text-zinc-200 placeholder-zinc-500 resize-none"
        />
        <button
          onClick={send}
          disabled={disabled || !message.trim()}
          className="px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors self-start"
        >
          Send directive
        </button>
      </div>
    </div>
  )
}

// ── Status header ──────────────────────────────────────────────────────────

export function StatusHeader({
  connected,
  runStatus,
  eventCount,
}: {
  connected: boolean
  runStatus: string
  eventCount: number
}) {
  const dot = connected ? 'bg-emerald-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-3 text-xs text-zinc-400">
      <span className="flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${dot}`} />
        {connected ? 'connected' : 'disconnected'}
      </span>
      <span className="font-mono">run: {runStatus}</span>
      <span className="font-mono">events: {eventCount}</span>
    </div>
  )
}
