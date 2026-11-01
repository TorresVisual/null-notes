import { chmodSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { browser, expect } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { fillPromptDialog } from '../promptDialog.js'
import { clickNewMenuItem } from '../sidebar.js'

const here = dirname(fileURLToPath(import.meta.url))
const cliExe = resolve(here, '../../src-tauri/cli/target/release/nullnotes.exe')
const appExe = resolve(here, '../../src-tauri/target/debug/null-notes.exe')

// Talks to whichever Null Notes owns the per-user pipe. Run this suite with no
// other Null Notes open, or the CLI reaches that one instead of the app under test.
function nullnotes(args: string[], input?: string) {
  const run = spawnSync(cliExe, [`--workspace=${fixtureWorkspace}`, ...args], {
    input,
    encoding: 'utf-8',
    env: { ...process.env, NULLNOTES_APP_EXE: appExe },
  })
  return { status: run.status, stdout: run.stdout, stderr: run.stderr }
}

describe('nullnotes CLI against the running app', () => {
  it('creates a note from stdin and finds it again by search', () => {
    const notePath = join(fixtureWorkspace, 'CLI Note.md')
    rmSync(notePath, { force: true })

    const created = nullnotes(
      ['note', 'create', '--folder', '', '--title', 'CLI Note', '--content', '-'],
      '# CLI Note\n\nzebrafish42 was here\n',
    )
    expect(created.status).toBe(0)
    expect(existsSync(notePath)).toBe(true)
    expect(readFileSync(notePath, 'utf-8')).toContain('zebrafish42')

    const found = nullnotes(['search', 'zebrafish42'])
    expect(found.status).toBe(0)
    const response = JSON.parse(found.stdout) as { ok: boolean; result: { results: { path: string }[] } }
    expect(response.ok).toBe(true)
    expect(response.result.results.map((r) => r.path)).toContain('CLI Note.md')
  })

  it('refuses to write a note whose edits are not on disk', async () => {
    const notePath = join(fixtureWorkspace, 'Dirty CLI Note.md')
    rmSync(notePath, { force: true })

    await clickNewMenuItem('Note')
    await fillPromptDialog('Dirty CLI Note')
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.ProseMirror')), {
      timeout: 5000,
      timeoutMsg: 'editor never mounted for the new note',
    })

    // A read-only file makes every autosave fail, which leaves the buffer
    // dirty for as long as the test needs it, with no race against the debounce.
    chmodSync(notePath, 0o444)
    try {
      await browser.execute(() => {
        const el = document.querySelector('.ProseMirror')
        if (!(el instanceof HTMLElement)) throw new Error('no element matching .ProseMirror')
        el.focus()
        const range = document.createRange()
        range.selectNodeContents(el)
        range.collapse(false)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
      })
      await browser.keys(['End', 'Enter'])
      await browser.keys('unsaved edit')

      let status: number | null = null
      await browser.waitUntil(
        () => {
          status = nullnotes(['note', 'write', 'Dirty CLI Note.md', '--content', 'from the CLI']).status
          return status === 5
        },
        { timeout: 15000, interval: 500, timeoutMsg: `note write never exited 5 (last exit: ${String(status)})` },
      )
    } finally {
      chmodSync(notePath, 0o666)
    }
    expect(readFileSync(notePath, 'utf-8')).not.toContain('from the CLI')
  })
})
