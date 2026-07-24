#!/usr/bin/env node
/**
 * MediaDL — Professional Release Pipeline
 *
 * Usage:
 *   node scripts/release.js            # build + package (NSIS installer + portable)
 *   node scripts/release.js --portable # portable only
 *   node scripts/release.js --installer # NSIS installer only
 *   node scripts/release.js --bump patch|minor|major  # bump version then release
 *
 * Outputs to:  release/<version>/
 */

import fs from 'fs'
import path from 'path'
import { execSync, spawnSync } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// ── Parse CLI args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const portableOnly  = args.includes('--portable')
const installerOnly = args.includes('--installer')
const bumpIdx       = args.indexOf('--bump')
const bumpType      = bumpIdx !== -1 ? args[bumpIdx + 1] : null

// ── Helpers ─────────────────────────────────────────────────────────────────
const step = (msg) => console.log(`\n\x1b[36m▶ ${msg}\x1b[0m`)
const ok   = (msg) => console.log(`  \x1b[32m✓ ${msg}\x1b[0m`)
const warn = (msg) => console.log(`  \x1b[33m⚠ ${msg}\x1b[0m`)
const fail = (msg) => { console.error(`  \x1b[31m✗ ${msg}\x1b[0m`); process.exit(1) }

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`)
  try {
    execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts })
  } catch (err) {
    fail(`Command failed: ${cmd}`)
  }
}

function readPkg() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
}

function writePkg(pkg) {
  fs.writeFileSync(path.join(ROOT, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8')
}

function bumpVersion(current, type) {
  const [maj, min, pat] = current.split('.').map(Number)
  if (type === 'major') return `${maj + 1}.0.0`
  if (type === 'minor') return `${maj}.${min + 1}.0`
  return `${maj}.${min}.${pat + 1}`
}

// ── Step 1: Version bump ────────────────────────────────────────────────────
step('Checking version')
const pkg = readPkg()

if (bumpType) {
  if (!['patch', 'minor', 'major'].includes(bumpType)) fail(`Invalid bump type: ${bumpType}. Use patch, minor or major.`)
  const oldVer = pkg.version
  pkg.version = bumpVersion(oldVer, bumpType)
  writePkg(pkg)
  ok(`Version bumped: ${oldVer} → ${pkg.version}`)
} else {
  ok(`Version: ${pkg.version}`)
}

const version = readPkg().version

// ── Step 2: Verify binaries ─────────────────────────────────────────────────
step('Verifying bundled binaries')
const binDir = path.join(ROOT, 'bin')
const requiredBins = ['yt-dlp.exe', 'ffmpeg.exe']
const missingBins  = requiredBins.filter(b => !fs.existsSync(path.join(binDir, b)))

if (missingBins.length > 0) {
  warn(`Missing binaries: ${missingBins.join(', ')} — running setup-binaries…`)
  run('node scripts/setup-binaries.js')
} else {
  for (const b of requiredBins) {
    const stat = fs.statSync(path.join(binDir, b))
    ok(`${b} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`)
  }
}

// ── Step 3: Build frontend ──────────────────────────────────────────────────
step('Building React frontend (vite build)')
run('npm run build')
const distDir = path.join(ROOT, 'dist-fe')
if (!fs.existsSync(distDir)) fail('dist-fe/ directory not found after build.')
ok(`Frontend built → dist-fe/`)

// ── Step 4: Package Electron ─────────────────────────────────────────────────
step('Packaging Electron app with electron-builder')
let builderTarget = ''
if (portableOnly)       builderTarget = '--win portable'
else if (installerOnly) builderTarget = '--win nsis'
else                    builderTarget = '--win nsis portable'

const shouldPublish = args.includes('--publish')
if (shouldPublish && !process.env.GH_TOKEN) {
  fail('GH_TOKEN environment variable is missing! Please create a GitHub Personal Access Token and set it in your environment variables to auto-publish.');
}

const publishFlag = shouldPublish ? '--publish always' : '--publish never'
run(`npx electron-builder ${builderTarget} ${publishFlag}`)
ok('Packaging complete')

// ── Step 5: Git Commit & Push ───────────────────────────────────────────────
if (bumpType || shouldPublish) {
  step('Committing and pushing to GitHub')
  try {
    run('git add package.json package-lock.json')
    // Only commit if there's actually something staged
    const statusResult = spawnSync('git', ['diff', '--staged', '--quiet'], { cwd: ROOT })
    if (statusResult.status !== 0) {
      // status !== 0 means there ARE staged changes — safe to commit
      run(`git commit -m "chore: release v${version}"`)
    } else {
      warn('Nothing to commit — version already up to date in git.')
    }
    run('git push')
    ok('Git push complete')
  } catch (e) {
    warn('Git commit/push failed. You may need to push manually.')
  }
}

// ── Step 6: Collect and verify artifacts ────────────────────────────────────
step('Collecting release artifacts')
const electronDist = path.join(ROOT, 'dist_electron')
const releaseDir   = path.join(ROOT, 'release', version)

// electron-builder default output directory
const builderOut = fs.existsSync(electronDist) ? electronDist : path.join(ROOT, 'dist_electron')
const distDirFallback = path.join(ROOT, 'dist')

// Find output directory used by electron-builder (may be 'dist_electron' or 'release' depending on config)
let artifactSrc = null
for (const candidate of ['release-build', 'dist', 'dist_electron', 'release_build']) {
  if (fs.existsSync(path.join(ROOT, candidate))) {
    const items = fs.readdirSync(path.join(ROOT, candidate))
    if (items.some(f => f.endsWith('.exe'))) {
      artifactSrc = path.join(ROOT, candidate)
      break
    }
  }
}

if (!artifactSrc) {
  warn('Could not auto-detect artifact output directory. Check the dist_electron/ or release/ folder manually.')
} else {
  fs.mkdirSync(releaseDir, { recursive: true })

  const exeFiles = fs.readdirSync(artifactSrc).filter(f => f.endsWith('.exe') || f.endsWith('.yml') || f.endsWith('.blockmap'))
  let copied = 0
  for (const file of exeFiles) {
    const src  = path.join(artifactSrc, file)
    const dest = path.join(releaseDir, file)
    fs.copyFileSync(src, dest)
    const stat = fs.statSync(dest)
    ok(`${file} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`)
    copied++
  }

  if (copied === 0) {
    warn('No .exe artifacts found. Build may have failed silently — check electron-builder output above.')
  } else {
    // Write a release manifest
    const manifest = {
      version,
      builtAt: new Date().toISOString(),
      platform: 'win32',
      targets: portableOnly ? ['portable'] : installerOnly ? ['nsis'] : ['nsis', 'portable'],
      artifacts: exeFiles.filter(f => f.endsWith('.exe'))
    }
    fs.writeFileSync(path.join(releaseDir, 'release.json'), JSON.stringify(manifest, null, 2), 'utf8')
    ok(`Manifest written → release/${version}/release.json`)
  }
}

// ── Done ─────────────────────────────────────────────────────────────────────
console.log(`\n\x1b[32m✅ Release ${version} complete!\x1b[0m`)
if (shouldPublish) {
  console.log(`\n\x1b[32m🚀 Successfully published to GitHub Releases!\x1b[0m`)
}
if (artifactSrc) {
  console.log(`   Artifacts: release/${version}/\n`)
}
