import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { fillPromptDialog } from '../promptDialog.js'

async function clickInPage(selector: string): Promise<void> {
  await browser.execute((sel) => {
    const el = document.querySelector(sel)
    if (!(el instanceof HTMLElement)) throw new Error(`clickInPage: no element matching ${sel}`)
    el.click()
  }, selector)
}

// The keydown fallback listens on `window`, but WebDriver's key-send targets
// whatever the page's active element is — with nothing focused there's no
// guarantee the event even gets dispatched into the document.
async function focusElement(selector: string): Promise<void> {
  await browser.execute((sel) => {
    const el = document.querySelector(sel)
    if (!(el instanceof HTMLElement)) throw new Error(`focusElement: no element matching ${sel}`)
    el.focus()
  }, selector)
}

// On Windows, WebView2 either claims a menu accelerator for its own
// browser-chrome shortcut or the native menu's accelerator table never fires
// on_menu_event at all — Layout.tsx's keydown fallback is what actually makes
// these work now. `browser.keys()` dispatches a real DOM keydown, which is
// exactly the path that fallback listens on (unlike the native menu itself,
// which WebDriver has no way to reach at all).
describe('Ctrl+E toggles source/preview', () => {
  it('switches the active note between wysiwyg and raw view and back', async () => {
    const notePath = join(fixtureWorkspace, 'Ctrl E Toggle.md')
    rmSync(notePath, { force: true })

    await clickInPage('.sidebar-new-actions button')
    await fillPromptDialog('Ctrl E Toggle')

    await browser.waitUntil(() => existsSync(notePath), {
      timeout: 5000,
      timeoutMsg: 'note file was never created on disk',
    })
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.ProseMirror')), {
      timeout: 5000,
      timeoutMsg: 'new note never opened in wysiwyg view',
    })
    await focusElement('.ProseMirror')

    await browser.keys(['Control', 'e'])

    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.raw-editor')), {
      timeout: 5000,
      timeoutMsg: 'Ctrl+E never switched the note into raw view',
    })
    expect(await browser.execute(() => !!document.querySelector('.ProseMirror'))).toBe(false)
    await focusElement('.raw-editor')

    await browser.keys(['Control', 'e'])

    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.ProseMirror')), {
      timeout: 5000,
      timeoutMsg: 'Ctrl+E never switched the note back to wysiwyg view',
    })
    expect(await browser.execute(() => !!document.querySelector('.raw-editor'))).toBe(false)
  })
})
