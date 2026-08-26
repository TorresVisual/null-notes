import { execSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { screenshot } from '../screenshot.js'
import { fillPromptDialog } from '../promptDialog.js'

// Routes through a real file rather than an inline PowerShell string: the
// snippet below has its own `$f`/quotes, and escaping those correctly for a
// one-line -Command string is exactly the kind of thing that's easy to get
// subtly wrong. `Get-Content -Raw | Set-Clipboard` sidesteps all of it.
function setClipboardText(text: string): void {
  const tmpFile = join(tmpdir(), 'null-notes-e2e-clipboard.txt')
  writeFileSync(tmpFile, text, 'utf-8')
  execSync(`powershell -NoProfile -Command "Get-Content -Raw '${tmpFile}' | Set-Clipboard"`)
}

// See create-note.e2e.ts / p6-academic-blocks.e2e.ts for why these helpers
// exist: WebdriverIO's own click()/waitForClickable() readiness polling is a
// slow round trip through this driver, and a plain in-page .click() doesn't
// give ProseMirror a real cursor position the way a mouse click does.
async function clickInPage(selector: string): Promise<void> {
  await browser.execute((sel) => {
    const el = document.querySelector(sel)
    if (!(el instanceof HTMLElement)) throw new Error(`clickInPage: no element matching ${sel}`)
    el.click()
  }, selector)
}

async function focusEditorEnd(): Promise<void> {
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
}

async function runSlashCommand(query: string, title: string = query): Promise<void> {
  await browser.keys('/')
  await browser.keys(query)
  await browser.waitUntil(
    async () =>
      browser.execute((t) => {
        const items = Array.from(document.querySelectorAll('.slash-menu-item .slash-item-title'))
        return items.some((el) => el.textContent === t)
      }, title),
    { timeout: 10000, timeoutMsg: `slash menu never showed an item titled "${title}"` },
  )
  await browser.execute((t) => {
    const items = Array.from(document.querySelectorAll('.slash-menu-item'))
    const match = items.find((el) => el.querySelector('.slash-item-title')?.textContent === t)
    if (!(match instanceof HTMLElement)) throw new Error(`no slash item titled "${t}"`)
    match.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  }, title)
}

async function createNote(title: string): Promise<string> {
  const notePath = join(fixtureWorkspace, `${title}.md`)
  rmSync(notePath, { force: true })

  await clickInPage('.sidebar-new-actions button')
  await fillPromptDialog(title)

  await focusEditorEnd()
  await browser.keys(['End', 'Enter'])
  return notePath
}

async function waitForSavedContent(notePath: string, needle: string): Promise<string> {
  await browser.waitUntil(
    () => existsSync(notePath) && readFileSync(notePath, 'utf-8').includes(needle),
    { timeout: 10000, interval: 300, timeoutMsg: `${notePath} never contained "${needle}"` },
  )
  return readFileSync(notePath, 'utf-8')
}

// Confirmed against lowlight directly (see CodeBlockEditor.ts): scores
// relevance 16 as "bash", comfortably over MIN_CONFIDENT_RELEVANCE.
const BASH_SNIPPET = '#!/bin/bash\nfor f in *.txt; do\n  echo "Processing $f"\n  cat "$f" >> combined.txt\ndone'

describe('P11-2: code block language auto-detect', () => {
  it('detects the language of a real clipboard paste and reflects it in the toolbar and saved file', async () => {
    const notePath = await createNote('P11-2 Language Detect')

    await runSlashCommand('Code', 'Code Block')
    await browser.waitUntil(
      async () => browser.execute(() => !!document.querySelector('.note-editor pre')),
      { timeout: 5000, timeoutMsg: 'code block never mounted' },
    )

    setClipboardText(BASH_SNIPPET)
    await browser.keys(['Control', 'v'])

    const content = await waitForSavedContent(notePath, 'Processing')
    expect(content).toContain('```bash')

    const language = await browser.execute(() => {
      const select = document.querySelector<HTMLSelectElement>('.code-language-control select')
      return select?.value
    })
    expect(language).toBe('bash')

    await screenshot('p11-2-language-auto-detect')
  })
})
