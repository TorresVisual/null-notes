export function updateTauriConf(content, version) {
  const json = JSON.parse(content)
  json.version = version
  return JSON.stringify(json, null, 2) + '\n'
}

export function updateCargoToml(content, version) {
  return content.replace(/^version = ".*"$/m, `version = "${version}"`)
}

// --- CLI entry point (below the Task 1 exports) ---
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function run(cmd) {
  execSync(cmd, { stdio: 'inherit' })
}

function main() {
  const bump = process.argv[2]
  if (!['patch', 'minor', 'major'].includes(bump)) {
    console.error('Usage: npm run release -- patch|minor|major')
    process.exit(1)
  }

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
