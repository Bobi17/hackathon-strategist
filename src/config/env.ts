// ── Environment — single source of truth is .env.local ─────────────────────
//
// LLM provider url/key/model (and any other runtime config) must NOT be
// hardcoded in code. They are read only from `.env.local` (or already-exported
// shell env, which takes priority). This module loads `.env.local` once at
// startup and fails fast with a clear message when a required var is missing.

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

let loaded = false

/**
 * Load `.env.local` into `process.env`. Idempotent. Values already present in
 * the environment are never overwritten (shell exports win), which also lets
 * tests and scripts stub env explicitly. No-op when the file is absent — the
 * provider validation in `detectProvider` then reports exactly what's missing.
 */
export function loadEnv(path = '.env.local'): void {
  if (loaded) return
  loaded = true
  const file = resolve(path)
  if (!existsSync(file)) return
  try {
    process.loadEnvFile(file)
  } catch (err) {
    throw new Error(`Failed to load ${file}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Read a required environment variable or fail with a pointer to `.env.local`.
 * Used for provider url/key/model so a missing value is never silently
 * substituted with a hardcoded default.
 */
export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing required env var ${name} — set it in .env.local (see .env.example).`,
    )
  }
  return value
}
