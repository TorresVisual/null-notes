import { execSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { screenshot } from '../screenshot.js'
import { fillPromptDialog } from '../promptDialog.js'

// Reads the real OS clipboard rather than stubbing `navigator.clipboard`
// inside the WebView: a stub needs a nested function literal injected via
// `browser.execute`, and that trips a real bug in this toolchain — the
// TS-to-JS step some `browser.execute` payloads pass through emits a
// `__name(...)` helper call for any function nested inside the outer
// callback, but only the outer callback's own source is what actually gets
// sent to the WebView, so the helper is undefined at eval time
// (`ReferenceError: __name is not defined`). Shelling out to PowerShell
// sidesteps it entirely, and verifies the real clipboard integration rather
// than a mock of it.
function readClipboardText(): string {
  return execSync('powershell -NoProfile -Command "Get-Clipboard"', { encoding: 'utf-8' }).replace(/\r?\n$/, '')
}

// See create-note.e2e.ts / p6-academic-blocks.e2e.ts for why these two
// helpers exist: WebdriverIO's own click()/waitForClickable() readiness
// polling is a slow round trip through this driver, and a plain in-page
// .click() doesn't give ProseMirror a real cursor position the way a mouse
// click does.
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
    // 10s, not the usual 5s: the very first slash command sent to a freshly
    // launched app pays a one-time render/JIT warmup cost that later
    // invocations in the same session don't (see e2e-verify's "Known
    // gotchas").
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

describe('P11-1: code block read-only affordances', () => {
  it('shows a line-number gutter that tracks the block\'s line count', async () => {
    const notePath = await createNote('P11-1 Line Numbers')

    await runSlashCommand('Code', 'Code Block')
    await browser.waitUntil(
      async () => browser.execute(() => !!document.querySelector('.note-editor pre')),
      { timeout: 5000, timeoutMsg: 'code block never mounted' },
    )

    await browser.keys('one')
    await waitForSavedContent(notePath, 'one')

    let gutterText = await browser.execute(() => document.querySelector('.code-line-numbers')?.textContent)
    expect(gutterText).toBe('1')

    await browser.keys(['Enter'])
    await browser.keys('two')
    await waitForSavedContent(notePath, 'two')

    gutterText = await browser.execute(() => document.querySelector('.code-line-numbers')?.textContent)
    expect(gutterText).toBe('1\n2')

    await screenshot('p11-1-line-numbers')
  })

  it('copies the block\'s text to the clipboard and shows transient feedback', async () => {
    await createNote('P11-1 Copy Button')

    await runSlashCommand('Code', 'Code Block')
    await browser.waitUntil(
      async () => browser.execute(() => !!document.querySelector('.note-editor pre')),
      { timeout: 5000, timeoutMsg: 'code block never mounted' },
    )
    await browser.keys('fn main() {}')

    await clickInPage('.code-block-copy')

    await browser.waitUntil(() => readClipboardText() === 'fn main() {}', {
      timeout: 3000,
      timeoutMsg: 'clipboard never received the code block\'s text',
    })

    const label = await browser.execute(() => document.querySelector('.code-block-copy')?.textContent)
    expect(label).toBe('Copied')

    await screenshot('p11-1-copy-button')
  })

  it('toggles word-wrap on the block without writing it to the saved file', async () => {
    const notePath = await createNote('P11-1 Word Wrap')

    await runSlashCommand('Code', 'Code Block')
    await browser.waitUntil(
      async () => browser.execute(() => !!document.querySelector('.note-editor pre')),
      { timeout: 5000, timeoutMsg: 'code block never mounted' },
    )
    await browser.keys(
      'a very long line of code that would otherwise scroll off the right edge of the visible code block area',
    )
    const content = await waitForSavedContent(notePath, 'very long line')
    expect(content).not.toContain('data-wrap')

    const wrapBefore = await browser.execute(() => document.querySelector('.note-editor pre')?.getAttribute('data-wrap'))
    expect(wrapBefore).toBe('false')

    await clickInPage('.code-block-wrap-toggle')
    await browser.waitUntil(
      async () => browser.execute(() => document.querySelector('.note-editor pre')?.getAttribute('data-wrap') === 'true'),
      { timeout: 3000, timeoutMsg: 'pre never gained data-wrap="true"' },
    )

    await screenshot('p11-1-word-wrap-on')

    // Presentation-only, like P6-1's collapse state: the toggle must never
    // reach the saved .md file.
    await browser.pause(1000)
    expect(readFileSync(notePath, 'utf-8')).not.toContain('data-wrap')
  })
})
