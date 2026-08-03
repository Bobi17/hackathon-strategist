// ── Persona registry — loads persona metadata from .agents/personas/ ───────

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface PersonaMeta {
  slug: string
  category: string
  name: string
  description: string
  color: string
  emoji: string
  vibe: string
}

const PERSONAS_DIR = join(import.meta.dirname, '../../.agents/personas')

/**
 * Load all persona metadata from the .agents/personas/ directory tree.
 * Reads only frontmatter (fast — no body parsing).
 */
export async function loadAllPersonas(): Promise<PersonaMeta[]> {
  const categories = await readdir(PERSONAS_DIR, { withFileTypes: true })
    .then((entries) => entries.filter((e) => e.isDirectory()).map((e) => e.name))

  const personas: PersonaMeta[] = []

  for (const cat of categories) {
    const catDir = join(PERSONAS_DIR, cat)
    const files = await readdir(catDir).catch(() => [] as string[])

    for (const file of files) {
      if (!file.endsWith('.md')) continue
      const slug = file.replace(/\.md$/, '')
      const raw = await readFile(join(catDir, file), 'utf-8')
      const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/)
      if (!fmMatch) continue

      const fm = fmMatch[1]!
      const get = (key: string): string =>
        fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim().replace(/^["']|["']$/g, '') ?? ''

      personas.push({
        slug,
        category: cat,
        name: get('name'),
        description: get('description'),
        color: get('color'),
        emoji: get('emoji'),
        vibe: get('vibe'),
      })
    }
  }

  return personas
}

/**
 * Find a persona by slug across all categories.
 */
export async function findPersona(slug: string): Promise<PersonaMeta | undefined> {
  const all = await loadAllPersonas()
  return all.find((p) => p.slug === slug)
}
