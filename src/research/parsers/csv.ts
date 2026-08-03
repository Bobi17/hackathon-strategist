// ── CSV parser — wraps csv-parse for dataset profiling ─────────────────────

import { readFile } from 'node:fs/promises'
import { parse } from 'csv-parse/sync'

export interface CSVProfile {
  path: string
  headers: string[]
  rowCount: number
  sample: Record<string, string>[]
}

/**
 * Parse a CSV file and return headers + up to 50 sample rows.
 */
export async function profileCSV(path: string): Promise<CSVProfile> {
  const content = await readFile(path, 'utf-8')
  const records: Record<string, string>[] = parse(content, {
    columns: true,
    skip_empty_lines: true,
    to: 50,
  })

  const headers = records.length > 0 ? Object.keys(records[0]!) : []

  return { path, headers, rowCount: records.length, sample: records }
}
