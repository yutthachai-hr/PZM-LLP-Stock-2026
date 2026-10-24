// Dedicated OCR staging deploy (owner, 24 Oct 2026, R67): build against the SEPARATE staging
// Firebase project and upload to the SEPARATE Pages project `pzmstock-staging`. Production's
// wrangler.toml and Pages project are never used. Every isolation check runs before anything is
// built or uploaded; `--dry-run` stops before the upload.
//
//   VITE_STAGING_FIREBASE_CONFIG='{"apiKey":…,"projectId":"pzm-stock-staging",…}' node scripts/deploy-staging.mjs [--dry-run]
//
// The web config is public (like production's BUILT_IN); the staging secrets live only on the
// staging Pages project (see deploy/staging/wrangler.toml) and are never read here.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PRODUCTION_PROJECT, stagingWebProject } from '../src/lib/deployTier.ts'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const OUT = join(ROOT, '.staging-deploy')
const dryRun = process.argv.includes('--dry-run')
const fail = (m) => { console.error(`deploy-staging: REFUSED — ${m}`); process.exit(1) }
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts })

// 1. The staging web config names a separate project and not production's web key, read from
// the one file that holds it (no copy here).
const web = process.env.VITE_STAGING_FIREBASE_CONFIG
const productionKey = readFileSync(join(ROOT, 'src/firebase/config.ts'), 'utf8').match(/apiKey:\s*'([^']+)'/)?.[1]
if (!productionKey) fail('could not read the production web config from src/firebase/config.ts')
const project = stagingWebProject(web, [productionKey])
if (!project) fail('VITE_STAGING_FIREBASE_CONFIG must be a complete web config of a separate, non-production project')

// 2. The staging Pages config is the staging project's, with its own bindings.
const toml = readFileSync(join(ROOT, 'deploy/staging/wrangler.toml'), 'utf8')
const prodToml = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8')
const ids = (t) => [...t.matchAll(/^\s*id\s*=\s*"([^"]+)"/gm)].map((m) => m[1])
if (!/^name\s*=\s*"pzmstock-staging"\s*$/m.test(toml)) fail('deploy/staging/wrangler.toml must name the pzmstock-staging project')
if (toml.includes(PRODUCTION_PROJECT) || /PRODUCTION_HOSTS/.test(toml)) fail('deploy/staging/wrangler.toml names something of production')
for (const id of ids(prodToml)) if (toml.includes(id)) fail(`deploy/staging/wrangler.toml uses production KV namespace ${id.slice(0, 6)}…`)
if (ids(toml).some((id) => !/^[0-9a-f]{32}$/.test(id))) fail('deploy/staging/wrangler.toml still has a placeholder KV namespace id (create the staging namespace first)')
const tomlProject = toml.match(/FIREBASE_PROJECT_ID\s*=\s*"([^"]+)"/)?.[1]
if (tomlProject !== project) fail(`FIREBASE_PROJECT_ID in deploy/staging/wrangler.toml (${tomlProject}) must equal the web config's project (${project})`)
if (!/DEPLOY_TIER\s*=\s*"staging"/.test(toml)) fail('deploy/staging/wrangler.toml must set DEPLOY_TIER = "staging"')

// 3. Build: a staging tier, not a Pages git build, not demo, not the emulator.
const env = { ...process.env, DEPLOY_TIER: 'staging', VITE_STAGING_FIREBASE_CONFIG: web }
for (const k of ['CF_PAGES', 'CF_PAGES_BRANCH', 'VITE_DEMO_MODE', 'VITE_USE_EMULATOR']) delete env[k]
sh('npm', ['run', '-s', 'build'], { cwd: ROOT, env })

// 4. The bundle carries the staging project. That it is a staging build is guaranteed by
// buildTier() in vite.config.ts, which throws unless the staging config is valid; the tier
// itself is inlined and folded by the minifier, so no text search could prove it (R67 review).
const assets = join(ROOT, 'dist/assets')
const js = readdirSync(assets).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(assets, f), 'utf8')).join('\n')
if (!js.includes(project)) fail('the built bundle does not carry the staging project')

// 5. Assemble an upload directory whose wrangler.toml is the staging one.
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT)
for (const d of ['dist', 'functions', 'src', 'worker']) cpSync(join(ROOT, d), join(OUT, d), { recursive: true })
cpSync(join(ROOT, 'package.json'), join(OUT, 'package.json'))
writeFileSync(join(OUT, 'wrangler.toml'), toml)
if (!existsSync(join(OUT, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(OUT, 'node_modules'), 'junction')

const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim()
console.log(`deploy-staging: checks passed — project ${project}, Pages project pzmstock-staging, commit ${sha.slice(0, 7)}`)
if (dryRun) {
  console.log(`deploy-staging: --dry-run, nothing uploaded (assembled in ${OUT})`)
  process.exit(0)
}
sh('npx', ['--no-install', 'wrangler', 'pages', 'deploy', 'dist', '--project-name', 'pzmstock-staging', '--branch', 'main', '--commit-hash', sha], { cwd: OUT })
