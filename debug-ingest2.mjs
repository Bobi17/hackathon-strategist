import { createBrowserSession } from './src/research/browser.ts'
import { ingestEvent } from './src/research/ingest.ts'

const config = {
  slug: 'cursor-hackathon-sait',
  name: 'Cursor Hackathon SAIT — May 2026',
  websiteUrls: ['https://cursorcalgary.com/calgary-hackathon-sait-may-2026/hackathon'],
  problemStatements: ['Build something that solves a real pain point in your personal life.'],
  dataFiles: [],
  sponsors: [],
  pastWinnersUrls: [],
  team: { size: 3, skills: ['typescript', 'react', 'llm', 'cursor'] },
  mode: 'headless',
  budgets: { researchHours: 1, maxRounds: 2, perRoundMinutes: 10, continueWithoutPause: true },
  useBrowser: true,
  minContentChars: 100,
  weights: { problemFit: 0.15, feasibility: 0.25, innovation: 0.25, stakeholderAlignment: 0.10, dataLeverage: 0.05, demoAbility: 0.20 },
}

const profileDir = '/data/hackathons/templates/hackathon-strategist/output/cursor-hackathon-sait/.cache/browser-profile'
const session = await createBrowserSession(profileDir, { headless: true })

if (!session) {
  console.log('No browser session available')
  process.exit(1)
}

const input = await ingestEvent(config, { session, auto: true })
console.log('=== ingestEvent result ===')
console.log('siteSections count:', input.siteSections.length)
for (const s of input.siteSections) {
  console.log('URL:', s.url)
  console.log('Content length:', s.content.length)
  console.log('Content preview:', s.content.slice(0, 200))
  console.log('---')
}
console.log('gaps:', input.gaps)
console.log('problemStatements:', input.problemStatements)

await session.close()