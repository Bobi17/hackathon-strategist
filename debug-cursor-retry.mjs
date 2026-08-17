import { createBrowserSession } from './src/research/browser.ts'
import { fetchWithEscalation } from './src/research/fetch.ts'

const url = 'https://cursorcalgary.com/calgary-hackathon-sait-may-2026/hackathon'

const config = {
  slug: 'cursor-test',
  name: 'Cursor Test',
  websiteUrls: [url],
  problemStatements: ['Build something.'],
  dataFiles: [],
  pastWinnersUrls: [],
  team: { size: 1, skills: ['typescript'] },
  mode: 'headless',
  budgets: { researchHours: 1, maxRounds: 1, perRoundMinutes: 2, continueWithoutPause: true },
  useBrowser: true,
  minContentChars: 50,
}

const profileDir = '/data/hackathons/templates/hackathon-strategist/output/cursor-test/.cache/browser-profile'
const session = await createBrowserSession(profileDir, { headless: true })

if (!session) {
  console.log('No browser session available')
  process.exit(1)
}

const deps = { session, auto: true }

console.log('=== Attempting render ===')
// Trying to render again to see if it's intermittent
const rendered = await session.render(url)
console.log('Rendered length:', rendered?.length)
console.log('Rendered preview:', rendered?.slice(0, 300))

await session.close()