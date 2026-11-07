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

export const TARGETS = ['windows', 'linux', 'android', 'ios']

const splitList = (v) => (v ? v.split(',').map((t) => t.trim()).filter(Boolean) : [])

export function resolveTargets({ only, skip } = {}) {
  if (only && skip) throw new Error('Use --only or --skip, not both.')
  const listed = splitList(only ?? skip)
  const unknown = listed.filter((t) => !TARGETS.includes(t))
  if (unknown.length) throw new Error(`Unknown target(s): ${unknown.join(', ')} (expected: ${TARGETS.join(', ')})`)
  const targets = TARGETS.filter((t) => (only ? listed.includes(t) : !listed.includes(t)))
  if (!targets.length) throw new Error('No targets left to build.')
  return targets
}

// release.yml reads the `targets:` line back out of the tag annotation; a tag without one builds everything.
export function tagMessages(tag, targets) {
  return targets.length === TARGETS.length ? [tag] : [tag, `targets: ${targets.join(',')}`]
}

export function readTargets(annotation) {
  const line = annotation.match(/^targets: (.+)$/m)
  return line ? resolveTargets({ only: line[1] }) : TARGETS
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
import { parseArgs } from 'node:util'
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

function tagArgs(tag, targets, force = false) {
  return ['tag', ...(force ? ['-f'] : []), '-a', ...tagMessages(tag, targets).flatMap((m) => ['-m', m])]
}

function existingTargets(tag) {
  const out = execFileSync('git', ['tag', '-l', '--format=%(contents)', tag], { encoding: 'utf8' })
  return readTargets(out)
}

function retag(options) {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
  const tag = `v${version}`
  const release = findRelease(tag)
  assertRetaggable(release, tag)
  if (release) run(`gh release delete ${tag} --yes`)
  const targets = options.only || options.skip ? resolveTargets(options) : existingTargets(tag)
  execFileSync('git', tagArgs(tag, targets, true), { stdio: 'inherit' })
  run('git push origin main')
  run(`git push --force origin ${tag}`)
  console.log(`Retagged ${tag} at HEAD (${targets.join(', ')})`)
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
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { only: { type: 'string' }, skip: { type: 'string' } },
  })
  const bump = positionals[0]
  if (!['patch', 'minor', 'major', 'retag'].includes(bump)) {
    console.error(`Usage: npm run release -- patch|minor|major|retag [--only|--skip ${TARGETS.join(',')}]`)
    process.exit(1)
  }
  if (bump === 'retag') return retag(values)
  const targets = resolveTargets(values)

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
  execFileSync('git', tagArgs(`v${version}`, targets), { stdio: 'inherit' })
  run('git push --follow-tags')

  console.log(`Released v${version} (${targets.join(', ')})`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
