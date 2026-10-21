import { execSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { screenshot } from '../screenshot.js'
import { fillPromptDialog } from '../promptDialog.js'
import { clickNewMenuItem } from '../sidebar.js'

// See p11-1's own e2e spec for why this beats stubbing navigator.clipboard
// from inside browser.execute: the TS-to-JS step some browser.execute
// payloads pass through emits a `__name(...)` helper call for any function
// nested inside the outer callback, and only the outer callback's own
// source reaches the WebView, leaving the helper undefined at eval time.
function readClipboardText(): string {
  return execSync('powershell -NoProfile -Command "Get-Clipboard"', { encoding: 'utf-8' }).replace(/\r?\n$/, '')
}

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
    // 10s, not the usual 5s: the very first slash command in a freshly
    // launched app pays a one-time render/JIT warmup cost later
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

  await clickNewMenuItem('Note')
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

describe('P12-1 and P12-2: math authoring polish', () => {
  it('numbers a block equation, copies its LaTeX, and resolves as an Equation (N) cross-reference', async () => {
    const equationNotePath = await createNote('P12-2 Equation Note')

    // A single-word substring, not the full title: the Suggestion plugin
    // backing this menu has allowSpaces: false, so typing the space in
    // "Block Math" would close the popup before the query ever finishes.
    await runSlashCommand('Block', 'Block Math')
    await browser.waitUntil(
      async () => browser.execute(() => !!document.querySelector('.block-math-editor-input')),
      { timeout: 5000, timeoutMsg: 'block math editor never opened' },
    )
    await browser.keys('E = mc^2')

    await browser.execute(() => {
      const input = document.querySelector<HTMLInputElement>('.block-math-number-input')
      if (!input) throw new Error('no .block-math-number-input')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, '3')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await browser.keys(['Control', 'Enter'])

    const saved = await waitForSavedContent(equationNotePath, 'E = mc^2')
    expect(saved).toContain('$3\nE = mc^2\n$')

    await browser.waitUntil(
      async () => browser.execute(() => document.querySelector('.block-math-number')?.textContent === '(3)'),
      { timeout: 5000, timeoutMsg: 'the equation number label never appeared' },
    )
    await screenshot('p12-2-numbered-equation')

    // P12-1: copy the raw LaTeX via the render view's edit overlay.
    await clickInPage('.block-math-render')
    await browser.waitUntil(
      async () => browser.execute(() => !!document.querySelector('.math-copy-button')),
      { timeout: 5000, timeoutMsg: 'copy button never appeared in the reopened editor' },
    )
    await clickInPage('.math-copy-button')
    await browser.waitUntil(() => readClipboardText() === 'E = mc^2', {
      timeout: 3000,
      timeoutMsg: 'clipboard never received the equation\'s LaTeX',
    })
    await browser.keys(['Escape'])

    // P12-2: reference it from a different note, same "wait past the
    // reindex debounce before referencing" margin P6-7's own cross-ref
    // e2e spec uses (REINDEX_DEBOUNCE_MS is 2.5s; this gives it headroom).
    const referenceNotePath = await createNote('P12-2 Reference Note')
    await browser.pause(4000)
    await browser.keys('See Equation (3) for the derivation.')
    await waitForSavedContent(referenceNotePath, 'See Equation (3) for the derivation.')

    await browser.waitUntil(
      async () => browser.execute(() => !!document.querySelector('.cross-ref:not(.cross-ref-missing)')),
      { timeout: 15000, interval: 500, timeoutMsg: '"Equation (3)" never resolved to a clickable reference' },
    )

    await clickInPage('.cross-ref')
    await browser.waitUntil(
      async () =>
        browser.execute(() => document.querySelector('.tab.active button')?.textContent === 'P12-2 Equation Note'),
      { timeout: 5000, timeoutMsg: 'clicking the cross-ref never switched to the defining note' },
    )
    await browser.waitUntil(
      async () => browser.execute(() => !!document.querySelector('.block-math.cross-ref-target[data-number="3"]')),
      { timeout: 5000, timeoutMsg: 'the numbered equation was never highlighted after navigating to it' },
    )
    await screenshot('p12-2-equation-cross-ref-jumped')
  })
})
