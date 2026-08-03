// ── Persona Runner — loads a persona and runs it via the LLM ───────────────

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { callLLM, extractJSON, type LLMResult } from './llm.js'
import { execTool, type ToolResult } from './tools.js'
import type { PersonaId } from '../data/types.js'

export interface PersonaFile {
  name: string
  description: string
  color: string
  emoji: string
  vibe: string
  body: string   // everything below the frontmatter
}

export interface RunResult {
  persona: PersonaId
  raw: string
  parsed?: unknown
  toolCalls: { name: string; args: Record<string, unknown>; result: ToolResult }[]
  llm: LLMResult
}

const PERSONAS_DIR = join(import.meta.dirname, '../../.agents/personas')

/**
 * Load a persona file from .agents/personas/. Parses YAML frontmatter manually
 * (no dependency needed — the format is simple enough).
 */
export async function loadPersona(category: string, slug: string): Promise<PersonaFile> {
  const path = join(PERSONAS_DIR, category, `${slug}.md`)
  const raw = await readFile(path, 'utf-8')

  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!fmMatch) throw new Error(`Invalid persona frontmatter: ${path}`)

  const fm = fmMatch[1]!
  const body = fmMatch[2]!

  const get = (key: string): string => {
    const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
    return m?.[1]?.trim().replace(/^["']|["']$/g, '') ?? ''
  }

  return {
    name: get('name'),
    description: get('description'),
    color: get('color'),
    emoji: get('emoji'),
    vibe: get('vibe'),
    body,
  }
}

/**
 * Run a persona with a given context message. Handles tool-use loop:
 * if the LLM requests a tool, execute it and feed the result back.
 * Returns the final text (persona's output).
 *
 * `opts.tools` gates the tool protocol (default false). Only personas that
 * genuinely need to fetch/read — the research personas — get tools offered;
 * everyone else works purely from provided context, so we never invite a
 * tool call that would disrupt their JSON output.
 *
 * IMPORTANT (context architecture): the local gateways (OmniRoute / LiteLLM)
 * CCR-compress USER messages above ~800 chars into unresolvable retrieval
 * stubs, but leave the SYSTEM prompt intact (verified to 16KB+). So all
 * persona context lives in the system prompt; the user message stays a short
 * instruction.
 */
export async function runPersona(
  persona: PersonaFile,
  contextMessage: string,
  opts?: { model?: string; maxToolRounds?: number; tools?: boolean; maxTokens?: number },
): Promise<RunResult> {
  const model = opts?.model
  const toolsEnabled = opts?.tools ?? false
  const maxToolRounds = opts?.maxToolRounds ?? 3
  const maxTokens = opts?.maxTokens
  const toolCalls: RunResult['toolCalls'] = []

  // Context goes in the system prompt (survives gateway compression).
  let systemPrompt = [
    persona.body,
    '',
    '## Output format',
    'Respond with a JSON object. Do not wrap it in a code fence.',
    'Example: { "findings": [...], "confidence": "high" }',
    toolsEnabled ? [
      '',
      '## Tool use',
      'If you need to fetch a URL or read a file, say exactly:',
      'TOOL:<toolName>:<JSON args>',
      'Example: TOOL:webFetch:{"url":"https://example.com"}',
      'Then wait for the result before continuing.',
    ].join('\n') : '',
    '',
    '## Provided context',
    contextMessage,
  ].filter((s) => s !== '').join('\n')

  // Cap the total system prompt so we stay well inside gateway limits.
  const MAX_SYSTEM = 32_000
  if (systemPrompt.length > MAX_SYSTEM) {
    systemPrompt = `${systemPrompt.slice(0, MAX_SYSTEM)}\n…[context truncated]`
  }

  // Short user message — anything larger gets CCR-compressed into a stub.
  let userMessage = 'Produce your JSON output now, using the provided context.'

  for (let round = 0; round <= maxToolRounds; round++) {
    const result = await callLLM(systemPrompt, userMessage, { model, maxTokens })
    const text = result.content

    // Check for tool calls (only when tools are offered)
    const toolMatch = toolsEnabled ? text.match(/^TOOL:(\w+):(.+)$/m) : null
    if (toolMatch && round < maxToolRounds) {
      const toolName = toolMatch[1]!
      const toolArgs = JSON.parse(toolMatch[2]!)
      const toolResult = await execTool(toolName, toolArgs)
      toolCalls.push({ name: toolName, args: toolArgs, result: toolResult })
      // Feed the tool result back through the system prompt (kept small).
      const toolText = toolResult.output.slice(0, 6_000)
      systemPrompt = `${systemPrompt}\n\n## Tool result (${toolName})\n${toolText}`
      userMessage = `Tool result received. Continue your analysis and produce your JSON output.`
      continue
    }

    // No tool call — parse the final output
    let parsed: unknown
    try {
      parsed = extractJSON(text)
    } catch {
      // Not JSON — that's okay for some personas (debate messages)
    }

    return { persona: 'unknown' as PersonaId, raw: text, parsed, toolCalls, llm: result }
  }

  throw new Error(`Persona ${persona.name} exceeded max tool rounds (${maxToolRounds})`)
}

/**
 * Run a persona by ID (convenience wrapper).
 */
export async function runPersonaById(
  personaId: PersonaId,
  contextMessage: string,
  opts?: { model?: string; maxToolRounds?: number; tools?: boolean; maxTokens?: number },
): Promise<RunResult> {
  const mapping = PERSONA_MAP[personaId]
  if (!mapping) throw new Error(`Unknown persona: ${personaId}`)
  const persona = await loadPersona(mapping.category, mapping.slug)
  const result = await runPersona(persona, contextMessage, opts)
  result.persona = personaId
  return result
}

// ── Persona → file mapping ─────────────────────────────────────────────────

const PERSONA_MAP: Record<PersonaId, { category: string; slug: string }> = {
  orchestrator: { category: 'orchestration', slug: 'orchestrator' },
  'event-intelligence-analyst': { category: 'research', slug: 'event-intelligence-analyst' },
  'sponsor-stakeholder-analyst': { category: 'research', slug: 'sponsor-stakeholder-analyst' },
  'past-winners-analyst': { category: 'research', slug: 'past-winners-analyst' },
  'data-analyst': { category: 'research', slug: 'data-analyst' },
  'innovation-scout': { category: 'creation', slug: 'innovation-scout' },
  'devils-advocate': { category: 'creation', slug: 'devils-advocate' },
  'decision-lead': { category: 'decision', slug: 'decision-lead' },
  judge: { category: 'reviewer', slug: 'judge' },
  'sponsor-reviewer': { category: 'reviewer', slug: 'sponsor-reviewer' },
  'audience-reviewer': { category: 'reviewer', slug: 'audience-reviewer' },
  'build-feasibility-reviewer': { category: 'reviewer', slug: 'build-feasibility-reviewer' },
}
