// Smoke test: spawn strategist --ui (no LLM env → degraded stubs), verify HTTP + WS.
import { spawn } from 'node:child_process'
import WebSocket from 'ws'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 8799
const proc = spawn('pnpm', ['exec', 'tsx', 'src/main.ts', '--config', 'config/events/example.json', '--ui'], {
  
  env: { ...process.env, OMNIROUTE_API_KEY: '', LITELLM_API_KEY: '', ANTHROPIC_API_KEY: '', CONTROL_ROOM_PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let log = ''
proc.stdout.on('data', d => { log += d.toString(); process.stdout.write('[strategist] ' + d) })
proc.stderr.on('data', d => { log += d.toString(); process.stderr.write('[err] ' + d) })

// 1) HTTP serves the built UI
let httpOk = false
for (let i = 0; i < 30; i++) {
  try {
    const res = await fetch(`http://localhost:${PORT}/`)
    httpOk = res.ok && (await res.text()).includes('Hackathon Strategist')
    if (httpOk) break
  } catch { /* not up yet */ }
  await sleep(500)
}
console.log('\nHTTP / serves UI:', httpOk)

// 2) WS client collects the stream
const ws = new WebSocket(`ws://localhost:${PORT}/ws`)
const seen = new Map<string, number>()
let complete = false
let gotDirective = false
ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw))
  if (msg.seq != null && msg.event) {
    seen.set(msg.event.kind, (seen.get(msg.event.kind) ?? 0) + 1)
    if (msg.event.kind === 'run' && msg.event.status === 'complete') complete = true
    if (msg.event.kind === 'directive' && msg.event.accepted) gotDirective = true
  } else if (msg.type === 'hello') console.log('WS hello:', JSON.stringify(msg))
})
await new Promise<void>((res) => ws.once('open', () => res()))
await sleep(200) // replay flush

// 3) Send an interject to exercise the control surface. The stub run completes
//    fast, but the server stays alive — so the directive still streams.
ws.send(JSON.stringify({ type: 'interject', persona: 'judge', message: 'Prioritize offline-first demo.' }))

// Wait for run completion AND the directive broadcast (server stays alive).
const deadline = Date.now() + 45_000
while ((!complete || !gotDirective) && Date.now() < deadline) await sleep(200)
ws.close()

console.log('\nEvent kinds seen:', Object.fromEntries([...seen.entries()].sort()))
console.log('Run completed:', complete, '| Directive streamed:', gotDirective)
proc.kill('SIGTERM')
await sleep(500)
process.exit(httpOk && complete && gotDirective ? 0 : 1)
