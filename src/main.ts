#!/usr/bin/env node

// ── Hackathon Strategist — CLI entry ───────────────────────────────────────
// Usage: pnpm strategist:run --config <path> [--ui | --headless]

import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { loadEnv } from './config/env.js'
import { loadConfig } from './config/schema.js'
import { detectProvider } from './agents/llm.js'
import { Orchestrator } from './engine/orchestrator.js'
import { ControlRoomServer } from './control-room/server.js'
import { DirectiveBroker } from './control-room/broker.js'

async function main(): Promise<void> {
  // Single source of truth for LLM provider url/key/model — must load before
  // any provider detection runs.
  loadEnv()

  const { values } = parseArgs({
    options: {
      config: { type: 'string', short: 'c' },
      ui: { type: 'boolean', default: false },
      headless: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  })

  if (values.help || !values.config) {
    console.log(`
🎯  Hackathon Strategist

Usage:
  pnpm strategist:run --config <path> [--ui | --headless]

Options:
  --config, -c   Path to the event config JSON (required)
  --ui           Run with control-room UI (launches WS server)
  --headless     Run without UI (default)
  --help, -h     Show this help

LLM provider — sourced only from .env.local (see .env.example):
  1. OMNIROUTE_API_KEY  → OmniRoute gateway (OMNIROUTE_BASE_URL, OMNIROUTE_MODEL)
  2. LITELLM_API_KEY    → LiteLLM gateway   (LITELLM_BASE_URL, LITELLM_MODEL)
  3. ANTHROPIC_API_KEY  → Anthropic direct  (ANTHROPIC_MODEL; optional ANTHROPIC_BASE_URL)
`)
    process.exit(values.help ? 0 : 1)
  }

  const configPath = resolve(values.config)
  console.log(`🎯  Loading config from ${configPath}`)

  const config = await loadConfig(configPath)
  const mode = values.ui ? 'ui' : values.headless ? 'headless' : config.mode

  // Detect and display LLM provider
  let providerInfo: string
  try {
    const provider = detectProvider()
    providerInfo = `${provider.type} (${provider.baseUrl || 'direct'} → ${provider.defaultModel})`
  } catch (err) {
    providerInfo = `NOT CONFIGURED — ${err instanceof Error ? err.message : String(err)}`
  }

  console.log(`   Event:    ${config.name} (${config.slug})`)
  console.log(`   Mode:     ${mode}`)
  console.log(`   Team:     ${config.team.size} people — ${config.team.skills.join(', ')}`)
  console.log(`   LLM:      ${providerInfo}`)
  console.log()

  // ── Control room (ui mode) ───────────────────────────────────────────────
  let server: ControlRoomServer | undefined
  if (mode === 'ui') {
    const broker = new DirectiveBroker()
    server = new ControlRoomServer({ broker, port: Number(process.env.CONTROL_ROOM_PORT ?? 8787) })
    await server.start()
    console.log(`🖥️   Control room live at  http://localhost:${server.port}   (WS: /ws)`)
    console.log(`   Interject → reviewer personas mid-loop; resolve gates in the browser.`)
    console.log()
  }

  const orch = new Orchestrator(config, { server, broker: server?.broker })
  const { outcome, artifactPaths } = await orch.run()

  console.log()
  console.log(`🏁  Run complete.`)
  console.log(`   Status:  ${outcome.status}`)
  console.log(`   Winner:  ${outcome.winner.oneLinePitch}`)
  console.log(`   Artifacts: ${artifactPaths.length} files written`)

  // In ui mode the server keeps serving the finished transcript — wait forever
  // (Ctrl-C to exit) so the browser tab stays useful after the run.
  if (server) {
    console.log(`\n   Control room still serving at http://localhost:${server.port} — Ctrl-C to exit.`)
    await new Promise(() => { /* keep alive */ })
  }
}

main().catch((err: unknown) => {
  console.error('❌  Strategist run failed:', err)
  process.exit(1)
})
