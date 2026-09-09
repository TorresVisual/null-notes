#!/usr/bin/env node
// Stop hook: runs `npm run typecheck` once per response, but only when this
// response actually touched a .ts/.tsx file — a full `tsc --noEmit` pass on
// every Stop event (including pure-research turns) would be wasted cost.
// Strict mode makes `any`/unchecked `!`/implicit `any` hard errors, and the
// pinned @tiptap/core+pm overrides mean a stray version drift produces
// unreadable duplicate-type errors — catching either right when they land
// is worth the run.

import { execFileSync } from 'node:child_process'

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()

function hasPendingTsChanges() {
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--', '*.ts', '*.tsx'], {
      cwd: projectDir,
      encoding: 'utf8',
    })
    return out.trim().length > 0
  } catch {
    // Not a git repo, or git unavailable — nothing to gate on, so don't block.
    return false
  }
}

if (!hasPendingTsChanges()) process.exit(0)

try {
  execFileSync('npm', ['run', 'typecheck'], { cwd: projectDir, stdio: 'inherit', shell: true })
  process.exit(0)
} catch {
  process.stderr.write('\ntypecheck failed — fix the errors above before finishing.\n')
  process.exit(2)
}
