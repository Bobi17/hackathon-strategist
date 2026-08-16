// ── Tool registry — tools available to persona runs ────────────────────────
// Each tool maps to a function the runner can invoke. Tools are role-scoped:
// the runner injects only the tools listed in IMPLEMENTATION_PLAN.md §1.

import { readFile } from 'node:fs/promises'
import { parse } from 'csv-parse/sync'

export interface ToolResult {
  ok: boolean
  output: string
  error?: string
}

/**
 * Per-run context injected into tool executions. The orchestrator supplies an
 * escalation-aware `fetch` (browser render + human auth gate) so personas can
 * read login-gated and JS-rendered pages too — not just plain-HTML sites.
 */
export interface ToolContext {
  /** Escalation-aware fetch returning normalized text (or null on failure). Falls back to plain fetch when absent. */
  fetch?: (url: string) => Promise<string | null>
}

export interface Tool {
  name: string
  description: string
  execute: (args: Record<string, unknown>, ctx?: ToolContext) => Promise<ToolResult>
}

// ── webFetch ───────────────────────────────────────────────────────────────

export const webFetch: Tool = {
  name: 'webFetch',
  description: 'Fetch a URL and return its text content (HTML normalized, boilerplate stripped).',
  async execute(args, ctx) {
    const url = args.url as string
    if (!url) return { ok: false, output: '', error: 'url is required' }
    try {
      if (ctx?.fetch) {
        // Escalation-aware path: browser render / human auth gate as needed.
        // The result is already normalized text.
        const text = await ctx.fetch(url)
        if (text === null) return { ok: false, output: '', error: 'fetch failed (page unreachable or login-gated)' }
        return { ok: true, output: text.slice(0, 50_000) }
      }
      const res = await fetch(url, {
        headers: { 'User-Agent': 'HackathonStrategist/0.1 (research-bot)' },
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) return { ok: false, output: '', error: `HTTP ${res.status}` }
      const html = await res.text()
      const text = stripBoilerplate(html)
      return { ok: true, output: text.slice(0, 50_000) } // cap at 50k chars
    } catch (err) {
      return { ok: false, output: '', error: String(err) }
    }
  },
}

function stripBoilerplate(html: string): string {
  // Simple: remove script/style tags and HTML tags, collapse whitespace
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── readFile ───────────────────────────────────────────────────────────────

export const readFileTool: Tool = {
  name: 'readFile',
  description: 'Read a local file and return its text content.',
  async execute(args) {
    const path = args.path as string
    if (!path) return { ok: false, output: '', error: 'path is required' }
    try {
      const content = await readFile(path, 'utf-8')
      return { ok: true, output: content.slice(0, 100_000) }
    } catch (err) {
      return { ok: false, output: '', error: String(err) }
    }
  },
}

// ── csvParse ───────────────────────────────────────────────────────────────

export const csvParse: Tool = {
  name: 'csvParse',
  description: 'Parse a CSV file and return its headers + first 100 rows as JSON.',
  async execute(args) {
    const path = args.path as string
    if (!path) return { ok: false, output: '', error: 'path is required' }
    try {
      const content = await readFile(path, 'utf-8')
      const records = parse(content, { columns: true, skip_empty_lines: true, to: 100 })
      const headers = records.length > 0 ? Object.keys(records[0]!) : []
      return {
        ok: true,
        output: JSON.stringify({ headers, rowCount: records.length, sample: records }, null, 2),
      }
    } catch (err) {
      return { ok: false, output: '', error: String(err) }
    }
  },
}

// ── summarize ──────────────────────────────────────────────────────────────

export const summarize: Tool = {
  name: 'summarize',
  description: 'Produce a brief summary (key points) of the given text.',
  async execute(args) {
    const text = args.text as string
    if (!text) return { ok: false, output: '', error: 'text is required' }
    // Simple extractive summary: first 500 chars + sentence count
    const sentences = text.match(/[^.!?]+[.!?]+/g) ?? []
    const summary = sentences.slice(0, 10).join(' ')
    return {
      ok: true,
      output: JSON.stringify({
        sentenceCount: sentences.length,
        summary: summary.slice(0, 2_000),
        fullLength: text.length,
      }),
    }
  },
}

// ── Tool registry ──────────────────────────────────────────────────────────

export const ALL_TOOLS: Tool[] = [webFetch, readFileTool, csvParse, summarize]

export const TOOL_MAP = new Map(ALL_TOOLS.map((t) => [t.name, t]))

/**
 * Execute a tool call by name. Returns the ToolResult.
 */
export async function execTool(
  name: string,
  args: Record<string, unknown>,
  ctx?: ToolContext,
): Promise<ToolResult> {
  const tool = TOOL_MAP.get(name)
  if (!tool) return { ok: false, output: '', error: `Unknown tool: ${name}` }
  return tool.execute(args, ctx)
}
