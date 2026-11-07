export function updateTauriConf(content, version) {
  const json = JSON.parse(content)
  json.version = version
  return JSON.stringify(json, null, 2) + '\n'
}

export function updateCargoToml(content, version) {
  return content.replace(/^version = ".*"$/m, `version = "${version}"`)
}

export function assertRetaggable(release, tag) {
  if (release && !release.isDraft) {
    throw new Error(`${tag} is already published — bump the version instead of retagging.`)
  }
}

export function assertGreenMain(runs, sha) {
  const short = sha.slice(0, 7)
  const run = runs[0]
  if (!run) throw new Error(`No CI run found for ${short} on main — push it and wait for CI before releasing.`)
  if (run.status !== 'completed') throw new Error(`CI for ${short} is still ${run.status} — wait for it to finish.`)
  if (run.conclusion !== 'success') throw new Error(`CI for ${short} concluded ${run.conclusion} — fix main before releasing.`)
}

// --- CLI entry point (below the Task 1 exports) ---
import { execSync, execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function run(cmd) {
  execSync(cmd, { stdio: 'inherit' })
}

function findRelease(tag) {
  try {
    const out = execFileSync('gh', ['release', 'view', tag, '--json', 'isDraft'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return JSON.parse(out)
  } catch (e) {
    if (String(e.stderr).includes('release not found')) return null
    throw e
  }
}

function retag() {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
  const tag = `v${version}`
  const release = findRelease(tag)
  assertRetaggable(release, tag)
  if (release) run(`gh release delete ${tag} --yes`)
  run(`git tag -f -a ${tag} -m "${tag}"`)
  run('git push origin main')
  run(`git push --force origin ${tag}`)
  console.log(`Retagged ${tag} at HEAD`)
}

function checkMainIsGreen() {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const out = execFileSync(
    'gh',
    ['run', 'list', '--workflow', 'CI', '--branch', 'main', '--commit', sha, '--limit', '1', '--json', 'status,conclusion'],
    { encoding: 'utf8' },
  )
  assertGreenMain(JSON.parse(out), sha)
}

function main() {
  const bump = process.argv[2]
  if (bump === 'retag') return retag()
  if (!['patch', 'minor', 'major'].includes(bump)) {
    console.error('Usage: npm run release -- patch|minor|major|retag')
    process.exit(1)
  }

  checkMainIsGreen()

  // Bumps package.json only — no commit/tag, this script controls that.
  run(`npm version ${bump} --no-git-tag-version`)

  const { version } = JSON.parse(readFileSync('package.json', 'utf8'))

  writeFileSync(
    'src-tauri/tauri.conf.json',
    updateTauriConf(readFileSync('src-tauri/tauri.conf.json', 'utf8'), version),
  )
  writeFileSync(
    'src-tauri/Cargo.toml',
    updateCargoToml(readFileSync('src-tauri/Cargo.toml', 'utf8'), version),
  )

  run('git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml')
  run(`git commit -m "chore: release v${version}"`)
  run(`git tag -a v${version} -m "v${version}"`)
  run('git push --follow-tags')

  console.log(`Released v${version}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
