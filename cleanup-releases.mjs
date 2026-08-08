// cleanup-releases.mjs
// Rulează cu: node cleanup-releases.mjs
// Necesită: node 18+, internet access

// ============================================================
// CONFIGURARE — înlocuiește doar astea două:
// ============================================================
import fs from 'fs';
import path from 'path';

// Load .env manually if it exists
try {
  const envFile = fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf8');
  envFile.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) process.env[match[1]] = match[2].trim();
  });
} catch (e) {}

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || 'YOUR_GITHUB_TOKEN';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'YOUR_GEMINI_API_KEY';

const OWNER = 'iannC69'
const REPO = 'yt-dlp-inc'
const APP_NAME = 'MediaDL'
const APP_DESCRIPTION = 'a desktop app for downloading media from YouTube, Spotify, and other platforms'
// ============================================================

const GITHUB_API = 'https://api.github.com'
const GEMINI_API = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${GEMINI_API_KEY}`

const IGNORE_PATTERNS = [
  /^(da|dada|test|wip|temp|asdf|ok|done|x|up|a|b|c)$/i,
  /^chore: release v\d+\.\d+\.\d+$/i,
  /^fix\s+typo/i,
  /^update$/i,
  /^\d+$/,
  /^\.+$/,
  /^(aa+|bb+|cc+|dd+|xx+)$/i,
]

function isUselessCommit(message) {
  const trimmed = message.trim()
  if (trimmed.length < 4) return true
  return IGNORE_PATTERNS.some(p => p.test(trimmed))
}

// ── GitHub helpers ───────────────────────────────────────────

async function githubGet(path) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }
  })
  if (!res.ok) throw new Error(`GitHub GET ${path} → ${res.status}`)
  return res.json()
}

async function githubPatch(path, body) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`GitHub PATCH ${path} → ${res.status}`)
  return res.json()
}

async function getAllReleases() {
  let page = 1
  let all = []
  while (true) {
    const batch = await githubGet(`/repos/${OWNER}/${REPO}/releases?per_page=100&page=${page}`)
    if (batch.length === 0) break
    all = all.concat(batch)
    page++
  }
  return all
}

async function getCommitsBetweenTags(baseTag, headTag) {
  try {
    const data = await githubGet(`/repos/${OWNER}/${REPO}/compare/${baseTag}...${headTag}`)
    return data.commits.map(c => ({
      message: c.commit.message.split('\n')[0].trim(),
      sha: c.sha.substring(0, 7),
    }))
  } catch {
    return []
  }
}

// ── Gemini helper ────────────────────────────────────────────

async function askGemini(releases) {
  const releasesText = releases.map(r =>
    `Version ${r.version}:\nCommits:\n${r.commits.length > 0
      ? r.commits.map(c => `  - ${c.message}`).join('\n')
      : '  (no meaningful commits found)'
    }`
  ).join('\n\n')

  const prompt = `
You are writing professional release notes for ${APP_NAME}, ${APP_DESCRIPTION}.

Below are ${releases.length} versions with their raw commit messages.
Many commit messages are junk ("da", "dada", "test", "update", etc.) — ignore them.
Only use commits that describe real changes.

For EACH version, generate:
1. "description": one short sentence (max 12 words) describing what changed in this version.
   If there are truly no meaningful commits, use "Internal maintenance and stability improvements."
2. "changes": array of cleaned-up change entries. Each entry should:
   - Start with feat:, fix:, style:, refactor:, chore:, or perf:
   - Be written in clear, professional English
   - Describe something real about the app (downloads, UI, audio, video, etc.)
   - Be empty array [] if there are truly no real changes

${releasesText}

Respond ONLY with a valid JSON array, no markdown, no backticks, no explanation:
[
  {
    "version": "1.0.75",
    "description": "short description here",
    "changes": ["feat: description", "fix: description"]
  },
  ...
]
`

  const res = await fetch(GEMINI_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 8192,
      }
    })
  })

  if (!res.ok) throw new Error(`Gemini API → ${res.status}`)
  const data = await res.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]'

  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim())
  } catch {
    console.error('❌ Gemini returned invalid JSON:', text.substring(0, 200))
    return []
  }
}

// ── Format release body ──────────────────────────────────────

function formatReleaseBody(version, description, changes) {
  const lines = [`## ${description}`]
  if (changes.length > 0) {
    lines.push('')
    lines.push('### Changes')
    changes.forEach(c => lines.push(`- ${c}`))
  }
  return lines.join('\n')
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log(`\n🚀 MediaDL Release Cleanup — ${OWNER}/${REPO}`)
  console.log('='.repeat(50))

  // 1. Fetch all releases
  console.log('\n📦 Fetching all releases...')
  const allReleases = await getAllReleases()
  console.log(`   Found ${allReleases.length} releases`)

  // 2. Identify latest — NEVER touch this one
  const latestRelease = allReleases.find(r => r.prerelease === false && !r.draft)
  console.log(`   ⚠️  Latest (protected): ${latestRelease?.tag_name} — will NOT be modified`)

  // 3. Get releases to process (all except latest)
  const toProcess = allReleases.filter(r => r.id !== latestRelease?.id)
  console.log(`   Will process: ${toProcess.length} releases\n`)

  // 4. Fetch commits for each release
  console.log('📝 Fetching commits for each release...')
  const releaseData = []

  for (let i = 0; i < toProcess.length; i++) {
    const release = toProcess[i]
    const nextRelease = toProcess[i - 1] // releases are newest-first
    const baseTag = nextRelease?.tag_name || null

    process.stdout.write(`   [${i + 1}/${toProcess.length}] ${release.tag_name}... `)

    let commits = []
    if (baseTag) {
      commits = await getCommitsBetweenTags(baseTag, release.tag_name)
    }

    const filtered = commits.filter(c => !isUselessCommit(c.message))
    console.log(`${commits.length} commits, ${filtered.length} useful`)

    releaseData.push({
      id: release.id,
      version: release.tag_name.replace(/^v/, ''),
      tag: release.tag_name,
      commits: filtered,
      allCommits: commits,
    })

    // Small delay to avoid GitHub rate limiting
    await new Promise(r => setTimeout(r, 150))
  }

  // 5. Send ALL to Gemini in one batch
  console.log(`\n🤖 Sending ${releaseData.length} releases to Gemini for rewriting...`)
  console.log('   (This may take 10-30 seconds...)\n')

  // Process in batches of 20 to stay within token limits
  const BATCH_SIZE = 20
  const allResults = []

  for (let i = 0; i < releaseData.length; i += BATCH_SIZE) {
    const batch = releaseData.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    const totalBatches = Math.ceil(releaseData.length / BATCH_SIZE)

    console.log(`   Batch ${batchNum}/${totalBatches} (${batch.length} releases)...`)
    const results = await askGemini(batch)
    allResults.push(...results)

    if (i + BATCH_SIZE < releaseData.length) {
      await new Promise(r => setTimeout(r, 2000)) // wait between batches
    }
  }

  console.log(`   ✅ Gemini returned ${allResults.length} rewrites\n`)

  // 6. Update each release on GitHub
  console.log('💾 Updating releases on GitHub...')
  let updated = 0
  let failed = 0

  for (const result of allResults) {
    const release = releaseData.find(r => r.version === result.version ||
      r.tag === result.version ||
      r.tag === `v${result.version}`)
    if (!release) {
      console.log(`   ⚠️  Could not match version ${result.version} — skipping`)
      continue
    }

    const body = formatReleaseBody(result.version, result.description, result.changes)

    try {
      await githubPatch(`/repos/${OWNER}/${REPO}/releases/${release.id}`, { body })
      console.log(`   ✅ v${result.version}: ${result.description}`)
      updated++
    } catch (err) {
      console.log(`   ❌ v${result.version}: ${err.message}`)
      failed++
    }

    // Delay to avoid GitHub rate limiting
    await new Promise(r => setTimeout(r, 300))
  }

  // 7. Done
  console.log('\n' + '='.repeat(50))
  console.log(`✅ Done! Updated: ${updated} | Failed: ${failed} | Protected: 1 (latest)`)
  console.log(`\n🔗 Check results: https://github.com/${OWNER}/${REPO}/releases\n`)
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message)
  process.exit(1)
})
