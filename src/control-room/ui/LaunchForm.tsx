// ── LaunchForm — feed the hackathon event from the control room ────────────
// Interactive mode: the server starts without a --config file and waits for
// the event info to come from the browser. This form builds an EventConfig
// (the same shape as config/events/*.json) and POSTs it to /api/run.
// A JSON-paste mode covers power users who already have a config file.

import { useState } from 'react'

export interface LaunchError {
  field: string
  message: string
}

interface Props {
  onLaunch: (config: unknown) => Promise<{ ok: boolean; errors?: LaunchError[] }>
}

interface FormState {
  name: string
  slug: string
  websiteUrls: string
  problemStatements: string
  dataFiles: string
  rubricUrl: string
  pastWinnersUrls: string
  sponsors: { name: string; url: string; track: string; prize: string }[]
  teamSize: string
  teamSkills: string
  researchHours: string
  maxRounds: string
  perRoundMinutes: string
  continueWithoutPause: boolean
  approveTop3: boolean
  approveWinner: boolean
}

const EMPTY: FormState = {
  name: '',
  slug: '',
  websiteUrls: '',
  problemStatements: '',
  dataFiles: '',
  rubricUrl: '',
  pastWinnersUrls: '',
  sponsors: [],
  teamSize: '3',
  teamSkills: 'typescript, react',
  researchHours: '1',
  maxRounds: '3',
  perRoundMinutes: '10',
  continueWithoutPause: true,
  approveTop3: false,
  approveWinner: false,
}

const EXAMPLE_JSON = `{
  "slug": "example",
  "name": "Example AI Hackathon 2026",
  "websiteUrls": ["https://example-hackathon.dev"],
  "problemStatements": [
    "Build an AI-powered solution for supply-chain visibility — help logistics teams predict and prevent disruptions before they happen."
  ],
  "sponsors": [{ "name": "ACME Logistics", "url": "https://acme-logistics.com", "track": "Supply Chain AI", "prize": "$10,000" }],
  "pastWinnersUrls": ["https://example-hackathon.dev/2025-winners"],
  "team": { "size": 3, "skills": ["typescript", "react", "llm"] },
  "budgets": { "researchHours": 1, "maxRounds": 2, "perRoundMinutes": 10, "continueWithoutPause": true }
}`

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'event'
}

function lines(s: string): string[] {
  return s.split('\n').map((l) => l.trim()).filter(Boolean)
}

function num(s: string): number | undefined {
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function buildConfig(f: FormState): Record<string, unknown> {
  const sponsors = f.sponsors
    .filter((s) => s.name.trim())
    .map((s) => ({ name: s.name.trim(), url: s.url.trim() || undefined, track: s.track.trim() || undefined, prize: s.prize.trim() || undefined }))
  return {
    slug: f.slug.trim() || slugify(f.name),
    name: f.name.trim(),
    websiteUrls: lines(f.websiteUrls),
    problemStatements: lines(f.problemStatements),
    dataFiles: f.dataFiles.trim() ? lines(f.dataFiles) : undefined,
    rubricUrl: f.rubricUrl.trim() || undefined,
    sponsors: sponsors.length ? sponsors : undefined,
    pastWinnersUrls: f.pastWinnersUrls.trim() ? lines(f.pastWinnersUrls) : undefined,
    team: { size: Number(f.teamSize) || 1, skills: f.teamSkills.split(',').map((s) => s.trim()).filter(Boolean) },
    budgets: {
      researchHours: num(f.researchHours),
      maxRounds: num(f.maxRounds),
      perRoundMinutes: num(f.perRoundMinutes),
      continueWithoutPause: f.continueWithoutPause,
    },
    gates: { approveTop3: f.approveTop3, approveWinner: f.approveWinner },
  }
}

const input = 'w-full bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-cyan-500'
const label = 'block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1'
const section = 'rounded-xl border border-zinc-800 bg-zinc-900/40 p-4'

export function LaunchForm({ onLaunch }: Props) {
  const [mode, setMode] = useState<'form' | 'json'>('form')
  const [form, setForm] = useState<FormState>(EMPTY)
  const [jsonText, setJsonText] = useState(EXAMPLE_JSON)
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<LaunchError[] | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const setSponsor = (i: number, key: 'name' | 'url' | 'track' | 'prize', value: string) =>
    setForm((f) => ({
      ...f,
      sponsors: f.sponsors.map((s, j) => (j === i ? { ...s, [key]: value } : s)),
    }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrors(null)
    setStatus(null)

    let config: unknown
    if (mode === 'json') {
      try {
        config = JSON.parse(jsonText)
      } catch {
        setErrors([{ field: 'JSON', message: 'Invalid JSON — check the syntax.' }])
        return
      }
    } else {
      config = buildConfig(form)
    }

    setSubmitting(true)
    const res = await onLaunch(config)
    setSubmitting(false)
    if (!res.ok) {
      setErrors(res.errors?.length ? res.errors : [{ field: 'run', message: 'The run could not be started.' }])
    } else {
      setStatus('Run started — watch it live below.')
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <div>
          <h2 className="text-lg font-bold">Start a new run</h2>
          <p className="text-sm text-zinc-400">
            Feed the hackathon event here instead of a <code className="text-cyan-400">config/events/*.json</code> file.
          </p>
        </div>
        <div className="flex rounded-lg border border-zinc-700 overflow-hidden text-sm">
          {(['form', 'json'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setErrors(null) }}
              className={`px-3 py-1.5 capitalize transition-colors ${mode === m ? 'bg-cyan-700 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
            >
              {m === 'form' ? 'Form' : 'Paste JSON'}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === 'json' ? (
          <div className={section}>
            <label className={label}>Event config (JSON)</label>
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              rows={18}
              spellCheck={false}
              className={`${input} font-mono text-xs`}
            />
            <p className="mt-2 text-xs text-zinc-500">
              Paste any <code className="text-cyan-400">config/events/*.json</code> file, or edit the example.
            </p>
          </div>
        ) : (
          <>
            <div className={`${section} grid grid-cols-1 md:grid-cols-2 gap-4`}>
              <div>
                <label className={label}>Event name *</label>
                <input className={input} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Example AI Hackathon 2026" />
              </div>
              <div>
                <label className={label}>Slug</label>
                <input className={input} value={form.slug} onChange={(e) => set('slug', e.target.value)} placeholder="auto from name" />
              </div>
              <div className="md:col-span-2">
                <label className={label}>Website URLs * (one per line)</label>
                <textarea className={`${input} font-mono text-xs`} rows={2} value={form.websiteUrls} onChange={(e) => set('websiteUrls', e.target.value)} placeholder="https://hackathon.example" />
              </div>
              <div className="md:col-span-2">
                <label className={label}>Problem statements * (one per line)</label>
                <textarea className={`${input} font-mono text-xs`} rows={3} value={form.problemStatements} onChange={(e) => set('problemStatements', e.target.value)} placeholder="Build an AI-powered solution for…" />
              </div>
              <div className="md:col-span-2">
                <label className={label}>Data files (paths relative to the project, one per line)</label>
                <textarea className={`${input} font-mono text-xs`} rows={2} value={form.dataFiles} onChange={(e) => set('dataFiles', e.target.value)} placeholder="data/train.csv" />
              </div>
              <div>
                <label className={label}>Rubric URL</label>
                <input className={input} value={form.rubricUrl} onChange={(e) => set('rubricUrl', e.target.value)} placeholder="https://…/judging-rubric" />
              </div>
              <div>
                <label className={label}>Past winners URLs (one per line)</label>
                <input className={input} value={form.pastWinnersUrls} onChange={(e) => set('pastWinnersUrls', e.target.value)} placeholder="https://…/2025-winners" />
              </div>
            </div>

            <div className={section}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Sponsors</h3>
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, sponsors: [...f.sponsors, { name: '', url: '', track: '', prize: '' }] }))}
                  className="text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                >
                  + Add sponsor
                </button>
              </div>
              {form.sponsors.length === 0 && <p className="text-xs text-zinc-500">Optional — add sponsors, their track, and prize.</p>}
              {form.sponsors.map((s, i) => (
                <div key={i} className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-2 items-center">
                  <input className={input} placeholder="Name" value={s.name} onChange={(e) => setSponsor(i, 'name', e.target.value)} />
                  <input className={input} placeholder="URL" value={s.url} onChange={(e) => setSponsor(i, 'url', e.target.value)} />
                  <input className={input} placeholder="Track" value={s.track} onChange={(e) => setSponsor(i, 'track', e.target.value)} />
                  <input className={input} placeholder="Prize" value={s.prize} onChange={(e) => setSponsor(i, 'prize', e.target.value)} />
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, sponsors: f.sponsors.filter((_, j) => j !== i) }))}
                    className="text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-red-900/50 text-zinc-400"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>

            <div className={`${section} grid grid-cols-1 md:grid-cols-3 gap-4`}>
              <div>
                <label className={label}>Team size</label>
                <input type="number" min={1} className={input} value={form.teamSize} onChange={(e) => set('teamSize', e.target.value)} />
              </div>
              <div className="md:col-span-2">
                <label className={label}>Team skills (comma-separated)</label>
                <input className={input} value={form.teamSkills} onChange={(e) => set('teamSkills', e.target.value)} placeholder="typescript, react, llm" />
              </div>
              <div>
                <label className={label}>Research hours</label>
                <input type="number" min={0} className={input} value={form.researchHours} onChange={(e) => set('researchHours', e.target.value)} />
              </div>
              <div>
                <label className={label}>Max debate rounds</label>
                <input type="number" min={1} className={input} value={form.maxRounds} onChange={(e) => set('maxRounds', e.target.value)} />
              </div>
              <div>
                <label className={label}>Minutes / round</label>
                <input type="number" min={1} className={input} value={form.perRoundMinutes} onChange={(e) => set('perRoundMinutes', e.target.value)} />
              </div>
              <label className="flex items-center gap-2 text-sm text-zinc-300 md:col-span-3">
                <input type="checkbox" className="accent-cyan-500" checked={form.continueWithoutPause} onChange={(e) => set('continueWithoutPause', e.target.checked)} />
                Run without pausing on gates (auto-resolve)
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-300">
                <input type="checkbox" className="accent-cyan-500" checked={form.approveTop3} onChange={(e) => set('approveTop3', e.target.checked)} />
                Gate: approve Top 3
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-300">
                <input type="checkbox" className="accent-cyan-500" checked={form.approveWinner} onChange={(e) => set('approveWinner', e.target.checked)} />
                Gate: approve winner
              </label>
            </div>
          </>
        )}

        {errors && (
          <div className="rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">
            {errors.map((e) => (
              <div key={e.field}><span className="font-mono text-red-400">{e.field}:</span> {e.message}</div>
            ))}
          </div>
        )}
        {status && <div className="rounded-lg border border-emerald-800 bg-emerald-950/40 p-3 text-sm text-emerald-300">{status}</div>}

        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
        >
          {submitting ? 'Starting run…' : 'Start run'}
        </button>
      </form>
    </div>
  )
}
