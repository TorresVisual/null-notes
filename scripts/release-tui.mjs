import readline from 'node:readline'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { TARGETS } from './release.mjs'

export const BUMPS = ['patch', 'minor', 'major', 'retag']

// A retag always names its targets: with no flag release.mjs would reuse the old tag's list, which a ticked box can't express.
export function buildArgs(bump, checked) {
  const all = checked.length === TARGETS.length
  return [bump, ...(bump === 'retag' || !all ? ['--only', checked.join(',')] : [])]
}

function render(state) {
  const row = (on, cursor, text) => `${cursor ? '\x1b[36m❯\x1b[0m' : ' '} ${on} ${text}`
  const lines = ['\x1b[1mRelease\x1b[0m  ↑/↓ move · space select · enter continue · esc cancel', '', 'Bump']
  BUMPS.forEach((b, i) => lines.push(row(state.bump === b ? '(●)' : '( )', state.cursor === i, b)))
  lines.push('', 'Targets')
  TARGETS.forEach((t, i) =>
    lines.push(row(state.checked.has(t) ? '[x]' : '[ ]', state.cursor === BUMPS.length + i, t)),
  )
  lines.push('', state.message ?? '')
  return lines
}

function main() {
  if (!process.stdin.isTTY) {
    console.error('release-tui needs an interactive terminal; use `npm run release -- <bump>` instead.')
    process.exit(1)
  }
  const state = { cursor: 0, bump: 'patch', checked: new Set(TARGETS), message: '', confirming: false }
  let drawn = 0

  const draw = () => {
    if (drawn) process.stdout.write(`\x1b[${drawn}A\x1b[0J`)
    const lines = state.confirming
      ? [`Release ${state.bump} (${TARGETS.filter((t) => state.checked.has(t)).join(', ')}) and push? [y/N]`]
      : render(state)
    process.stdout.write(lines.join('\n') + '\n')
    drawn = lines.length
  }

  const finish = (go) => {
    process.stdin.setRawMode(false)
    process.stdin.pause()
    if (!go) {
      console.log('Cancelled.')
      process.exit(0)
    }
    const args = buildArgs(state.bump, TARGETS.filter((t) => state.checked.has(t)))
    const { status } = spawnSync(process.execPath, ['scripts/release.mjs', ...args], { stdio: 'inherit' })
    process.exit(status ?? 1)
  }

  readline.emitKeypressEvents(process.stdin)
  process.stdin.setRawMode(true)
  process.stdin.on('keypress', (_, key = {}) => {
    if (key.ctrl && key.name === 'c') return finish(false)
    if (state.confirming) return finish(key.name === 'y')
    const rows = BUMPS.length + TARGETS.length
    state.message = ''
    if (key.name === 'escape') return finish(false)
    if (key.name === 'up') state.cursor = (state.cursor + rows - 1) % rows
    else if (key.name === 'down') state.cursor = (state.cursor + 1) % rows
    else if (key.name === 'space') {
      if (state.cursor < BUMPS.length) state.bump = BUMPS[state.cursor]
      else {
        const t = TARGETS[state.cursor - BUMPS.length]
        if (!state.checked.delete(t)) state.checked.add(t)
      }
    } else if (key.name === 'return') {
      if (!state.checked.size) state.message = 'Tick at least one target.'
      else state.confirming = true
    }
    draw()
  })
  draw()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
