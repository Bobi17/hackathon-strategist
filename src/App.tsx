// ── Hackathon Strategist — Control Room ────────────────────────────────────
// Live view of a strategist run: stage rail, transcript feed, scoring board,
// reviewer verdicts, gates, and interjections. Connects to the strategist server
// over WebSocket (/ws); replays the full event stream on connect.

import { useMemo, useState } from 'react'
import { useStrategistStream } from './control-room/ui/useStrategistStream'
import {
  GateControls,
  Interject,
  ScoreBoard,
  StageRail,
  StatusHeader,
  Transcript,
  VerdictPanel,
} from './control-room/ui/components'
import { LaunchForm } from './control-room/ui/LaunchForm'

export default function App() {
  const stream = useStrategistStream()
  const [selectedRound, setSelectedRound] = useState<number | null>(null)

  const latestRound = stream.rounds[stream.rounds.length - 1]
  const shownRound = useMemo(
    () => stream.rounds.find((r) => r.number === selectedRound) ?? latestRound,
    [stream.rounds, selectedRound, latestRound],
  )

  // Interactive mode: no run yet and the server accepts configs → launch form.
  const showLaunch = stream.runStatus === 'idle' && stream.acceptsRuns

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800 px-5 py-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight">⚡ Hackathon Strategist</h1>
            <span className="text-xs font-mono text-zinc-500">control room</span>
          </div>
          <StatusHeader connected={stream.connected} runStatus={stream.runStatus} eventCount={stream.eventCount} />
        </div>
        <div className="mt-3">
          <StageRail done={stream.stages} />
        </div>
      </header>

      {/* Body */}
      {showLaunch ? (
        <LaunchForm onLaunch={stream.launchRun} />
      ) : (
      <main className="grid grid-cols-1 lg:grid-cols-5 gap-4 px-5 py-4">
        {/* Transcript — 3/5 */}
        <section className="lg:col-span-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 max-h-[78vh] overflow-y-auto">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">Live transcript</h2>
          <Transcript feed={stream.feed} />
        </section>

        {/* Right rail — 2/5 */}
        <section className="lg:col-span-2 space-y-4">
          {stream.activeGate && (
            <GateControls
              activeGate={stream.activeGate}
              onResolve={stream.resolveGate}
              onPick={stream.pickWinner}
              onFeedback={stream.sendWinnerFeedback}
              onIngestRetry={stream.ingestRetry}
              onIngestPaste={stream.ingestPaste}
            />
          )}

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Scoring board</h2>
              {stream.rounds.length > 1 && (
                <select
                  value={selectedRound ?? latestRound?.number ?? ''}
                  onChange={(e) => setSelectedRound(Number(e.target.value))}
                  className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300"
                >
                  {stream.rounds.map((r) => (
                    <option key={r.number} value={r.number}>round {r.number}</option>
                  ))}
                </select>
              )}
            </div>
            <ScoreBoard round={shownRound} />
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
              Reviewer verdicts {shownRound ? `— round ${shownRound.number}` : ''}
            </h2>
            <VerdictPanel round={shownRound} />
          </div>

          <Interject onInterject={stream.interject} disabled={!stream.connected} />
        </section>
      </main>
      )}
    </div>
  )
}
