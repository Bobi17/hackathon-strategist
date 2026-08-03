// ── LLM client — multi-provider with retry + token tracking ────────────────
//
// Supports three providers, auto-detected from environment variables:
//   1. Anthropic SDK   — ANTHROPIC_API_KEY set → direct Anthropic API
//   2. OmniRoute       — OMNIROUTE_API_KEY set → OpenAI-compatible gateway
//   3. LiteLLM         — LITELLM_API_KEY set  → OpenAI-compatible gateway
//
// Priority: OMNIROUTE > LITELLM > Anthropic.  Override per call via LLMOptions.
//
// Provider url/key/model come ONLY from .env.local (loaded via loadEnv in
// main.ts) or already-exported shell env — nothing is hardcoded here. Missing
// vars fail fast via requireEnv instead of silently using a default.

import Anthropic from '@anthropic-ai/sdk'
import { requireEnv } from '../config/env.js'

// ── Types ──────────────────────────────────────────────────────────────────

export type LLMProvider = 'anthropic' | 'litellm' | 'omniroute'

export interface LLMResult {
  content: string
  inputTokens: number
  outputTokens: number
  model: string
  provider: LLMProvider
}

export interface LLMOptions {
  model?: string
  maxTokens?: number
  temperature?: number
  /** Override the auto-detected provider for this call. */
  provider?: LLMProvider
}

interface ProviderConfig {
  type: LLMProvider
  baseUrl: string
  apiKey: string
  defaultModel: string
}

// ── Provider detection ─────────────────────────────────────────────────────

const PROVIDER_ENV: Record<LLMProvider, { apiKey: string; baseUrl: string; model: string }> = {
  omniroute: { apiKey: 'OMNIROUTE_API_KEY', baseUrl: 'OMNIROUTE_BASE_URL', model: 'OMNIROUTE_MODEL' },
  litellm: { apiKey: 'LITELLM_API_KEY', baseUrl: 'LITELLM_BASE_URL', model: 'LITELLM_MODEL' },
  anthropic: { apiKey: 'ANTHROPIC_API_KEY', baseUrl: 'ANTHROPIC_BASE_URL', model: 'ANTHROPIC_MODEL' },
}

/** Build a provider's config strictly from env — no hardcoded url/model. */
function buildProvider(type: LLMProvider): ProviderConfig {
  const env = PROVIDER_ENV[type]
  const apiKey = requireEnv(env.apiKey)
  const defaultModel = requireEnv(env.model)
  // Anthropic hits the official API unless ANTHROPIC_BASE_URL is set (optional
  // gateway route). Gateway providers (OmniRoute/LiteLLM) always need a base URL.
  const baseUrl = type === 'anthropic' ? (process.env[env.baseUrl] ?? '') : requireEnv(env.baseUrl)
  return { type, baseUrl, apiKey, defaultModel }
}

/**
 * Detect which provider is available from environment variables.
 * Priority: OMNIROUTE > LITELLM > Anthropic. Throws if none is configured, or
 * if the selected provider's url/model are missing from `.env.local`.
 */
export function detectProvider(): ProviderConfig {
  if (process.env.OMNIROUTE_API_KEY) return buildProvider('omniroute')
  if (process.env.LITELLM_API_KEY) return buildProvider('litellm')
  if (process.env.ANTHROPIC_API_KEY) return buildProvider('anthropic')
  throw new Error(
    'No LLM provider configured. Set exactly one of OMNIROUTE_API_KEY, ' +
    'LITELLM_API_KEY, or ANTHROPIC_API_KEY in .env.local (see .env.example).',
  )
}

// ── Anthropic SDK client ───────────────────────────────────────────────────

let anthropicClient: Anthropic | null = null
let anthropicBaseUrl = ''

function getAnthropicClient(apiKey: string, baseUrl: string): Anthropic {
  if (!anthropicClient || baseUrl !== anthropicBaseUrl) {
    anthropicClient = new Anthropic({ apiKey, baseURL: baseUrl || undefined })
    anthropicBaseUrl = baseUrl
  }
  return anthropicClient
}

async function callAnthropic(
  systemPrompt: string,
  userMessage: string,
  provider: ProviderConfig,
  opts: LLMOptions,
): Promise<LLMResult> {
  const model = opts.model ?? provider.defaultModel
  const client = getAnthropicClient(provider.apiKey, provider.baseUrl)

  const response = await client.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 4_096,
    temperature: opts.temperature ?? 0.7,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  })

  const textBlock = response.content.find((b) => b.type === 'text')
  return {
    content: textBlock?.text ?? '',
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    model: response.model,
    provider: 'anthropic',
  }
}

// ── OpenAI-compatible client (LiteLLM / OmniRoute) ─────────────────────────

async function callOpenAICompatible(
  systemPrompt: string,
  userMessage: string,
  provider: ProviderConfig,
  opts: LLMOptions,
): Promise<LLMResult> {
  const model = opts.model ?? provider.defaultModel
  const url = `${provider.baseUrl}/chat/completions`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: opts.maxTokens ?? 4_096,
      temperature: opts.temperature ?? 0.7,
      stream: false, // some gateways (OmniRoute) default to SSE streaming
    }),
    // Gateway latency under concurrent persona calls can exceed 60s — make it
    // tunable via env, default generous (120s).
    signal: AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS ?? 120_000)),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${provider.type} API error ${res.status}: ${body.slice(0, 500)}`)
  }

  const data = await res.json() as {
    choices: { message: { content: string } }[]
    usage?: { prompt_tokens: number; completion_tokens: number }
    model: string
  }

  return {
    content: data.choices[0]?.message?.content ?? '',
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
    model: data.model ?? model,
    provider: provider.type,
  }
}

// ── Unified callLLM ────────────────────────────────────────────────────────

const MAX_RETRIES = 2
const RETRY_DELAY_MS = 1_000

/**
 * Send a system + user message to the configured LLM provider.
 * Retries on transient errors (429, 500, 529). Returns text + token usage.
 */
export async function callLLM(
  systemPrompt: string,
  userMessage: string,
  opts: LLMOptions = {},
): Promise<LLMResult> {
  const provider = opts.provider ? buildProvider(opts.provider) : detectProvider()

  let lastError: unknown

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (provider.type === 'anthropic') {
        return await callAnthropic(systemPrompt, userMessage, provider, opts)
      }
      return await callOpenAICompatible(systemPrompt, userMessage, provider, opts)
    } catch (err: unknown) {
      lastError = err

      // Determine if retryable
      let retryable = false
      if (err instanceof Anthropic.APIError) {
        retryable = err.status === 429 || err.status === 500 || err.status === 529
      } else if (err instanceof Error) {
        retryable = err.message.includes('429') || err.message.includes('500') || err.message.includes('529')
          // Timeouts are transient — a slower gateway slot is worth one retry.
          || err.name === 'TimeoutError' || err.name === 'AbortError'
          || err.message.includes('timed out') || err.message.includes('aborted due to timeout')
      }

      if (!retryable || attempt >= MAX_RETRIES) break
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)))
    }
  }

  throw lastError
}

/**
 * Extract a JSON object from LLM text output. Robust against the common
 * LLM JSON errors:
 *   - markdown code fences around the object
 *   - literal control characters inside string values (unescaped newlines)
 *   - trailing prose after the object (or multiple objects)
 * Strategy: try direct parse → brace-match the first complete object →
 * strip control chars and retry.
 */
export function extractJSON(text: string): unknown {
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  const raw = (fenceMatch?.[1] ?? text).trim()

  // 1. Direct parse
  try {
    return JSON.parse(raw)
  } catch {
    // fall through
  }

  // 2. Strip literal control characters (unescaped \n, \t inside strings
  //    are the #1 LLM JSON error) and retry.
  // eslint-disable-next-line no-control-regex -- intentional: strip literal control chars
  const repaired = raw.replace(/[\x00-\x1F\x7F]/g, ' ')
  try {
    return JSON.parse(repaired)
  } catch {
    // fall through
  }

  // 3. Brace-match the first complete object on the repaired text
  //    (handles trailing prose / multiple concatenated objects).
  const start = repaired.indexOf('{')
  if (start >= 0) {
    let depth = 0
    let inStr = false
    let escape = false
    for (let i = start; i < repaired.length; i++) {
      const ch = repaired[i]!
      if (inStr) {
        if (escape) escape = false
        else if (ch === '\\') escape = true
        else if (ch === '"') inStr = false
        continue
      }
      if (ch === '"') inStr = true
      else if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          return JSON.parse(repaired.slice(start, i + 1))
        }
      }
    }
  }

  // 4. Salvage TRUNCATED output — the model sometimes stops mid-string.
  //    Keep every complete array element, drop the partial tail.
  const salvaged = salvageTruncatedJSON(repaired)
  if (salvaged !== null) return salvaged

  throw new Error('Could not extract JSON from model output')
}

/**
 * Salvage a truncated JSON document. The model sometimes stops mid-string.
 * Strategy: track brace depth; keep the longest complete prefix (prefer the
 * last complete array element), close any unterminated string, drop a trailing
 * comma, then close the remaining brackets. Returns null if nothing is
 * salvageable.
 */
function salvageTruncatedJSON(raw: string): unknown | null {
  const stack: ('{' | '[')[] = []
  let inStr = false
  let escape = false
  let lastElementEnd = -1 // last index closing a complete array element
  let lastValueEnd = -1   // last index closing ANY complete value
  let elementStack: ('{' | '[')[] = [] // stack state at last complete element

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!
    if (inStr) {
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === '"') {
        inStr = false
        lastValueEnd = i
      }
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{' || ch === '[') stack.push(ch as '{' | '[')
    else if (ch === '}' || ch === ']') {
      stack.pop()
      lastValueEnd = i
      if (stack[stack.length - 1] === '[') {
        lastElementEnd = i
        elementStack = stack.slice()
      }
    }
  }

  if (stack.length === 0) return null // balanced → not truncated

  // Cut at the last complete element (or last complete value). Both are
  // non-string boundaries, so the partial tail (incl. any open string) is
  // simply dropped — never append a closing quote here.
  const cutAt = lastElementEnd >= 0 ? lastElementEnd : lastValueEnd
  if (cutAt < 0) return null

  let prefix = raw.slice(0, cutAt + 1)
  prefix = prefix.replace(/,\s*$/, '') // drop trailing comma before closing

  // Close brackets from the stack state AT the cut, not the final state
  // (the tail brackets belong to the partial element we dropped).
  const closeStack = lastElementEnd >= 0 ? elementStack : stack
  for (let k = closeStack.length - 1; k >= 0; k--) {
    prefix += closeStack[k] === '{' ? '}' : ']'
  }

  try {
    return JSON.parse(prefix)
  } catch {
    return null
  }
}
