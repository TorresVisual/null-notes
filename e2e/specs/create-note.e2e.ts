import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'

// WebdriverIO's Element#click() runs its own overlap/visibility readiness
// check before clicking. Through @wdio/tauri-service's official
// driverProvider in this environment, each iteration of that check is a slow
// round trip, turning a near-instant real UI state into a 10-20s stall per
// click. Dispatching the click as plain in-page JS bypasses that check
// entirely — the element already exists by the time findElement resolves it,
// which is sufficient readiness here.
async function clickInPage(selector: string): Promise<void> {
  await browser.execute((sel) => {
    const el = document.querySelector(sel)
    if (!(el instanceof HTMLElement)) {
      throw new Error(`clickInPage: no element matching ${sel}`)
    }
    el.click()
  }, selector)
}

describe('create note → type → save', () => {
  it('writes the typed content to the .md file on disk', async () => {
    const notePath = join(fixtureWorkspace, 'Test Note.md')
    // fixtureWorkspace is a fixed, shared path (see fixtureWorkspace.ts) —
    // clear any note left behind by a previous run so a failed create/type
    // step can't pass this assertion against stale content.
    rmSync(notePath, { force: true })

    await clickInPage('.sidebar-new-actions button')

    // window.prompt() is a native modal outside the WebView DOM — the
    // standard WebDriver "user prompt" commands are the only way to reach it.
    await browser.waitUntil(
      async () => {
        try {
          await browser.getAlertText()
          return true
        } catch {
          return false
        }
      },
      { timeout: 5000, timeoutMsg: 'the note-title prompt() never appeared' },
    )
    await browser.sendAlertText('Test Note')
    await browser.acceptAlert()

    // A plain in-page .click() focuses the contenteditable root but doesn't
    // establish a real cursor position the way a mouse click does — ProseMirror
    // needs an actual DOM Selection to know where typed input goes. Focus the
    // editor and collapse the selection to the end of its content explicitly.
    await browser.execute(() => {
      const el = document.querySelector('.ProseMirror')
      if (!(el instanceof HTMLElement)) {
        throw new Error('no element matching .ProseMirror')
      }
      el.focus()
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    })
    // A fresh note opens with the cursor in the title heading — move past it
    // into a new paragraph so the typed text doesn't merge into the title.
    await browser.keys(['End', 'Enter'])
    await browser.keys('Hello from the E2E test')

    await browser.waitUntil(
      () => existsSync(notePath) && readFileSync(notePath, 'utf-8').includes('Hello from the E2E test'),
      { timeout: 10000, interval: 300, timeoutMsg: `${notePath} never contained the typed text` },
    )

    expect(readFileSync(notePath, 'utf-8')).toContain('Hello from the E2E test')
  })
})
