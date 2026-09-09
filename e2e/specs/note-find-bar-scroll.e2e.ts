import { join } from 'node:path'
import { browser } from '@wdio/globals'
import { rmSync } from 'node:fs'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { fillPromptDialog } from '../promptDialog.js'
import { screenshot } from '../screenshot.js'

// WebdriverIO's Element#click() runs its own overlap/visibility readiness
// check before clicking — see create-note.e2e.ts's clickInPage for why this
// project always dispatches clicks as plain in-page JS instead.
async function clickInPage(selector: string): Promise<void> {
  await browser.execute((sel) => {
    const el = document.querySelector(sel)
    if (!(el instanceof HTMLElement)) throw new Error(`clickInPage: no element matching ${sel}`)
    el.click()
  }, selector)
}

describe('note find bar (Ctrl+F) while scrolled mid-file', () => {
  it('stays pinned in view and does not reset the scroll position when opened', async () => {
    rmSync(join(fixtureWorkspace, 'Scroll Find Note.md'), { force: true })

    await clickInPage('.sidebar-new-actions button')
    await fillPromptDialog('Scroll Find Note')
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.ProseMirror')), {
      timeout: 5000,
      timeoutMsg: 'editor never mounted for the new note',
    })

    // Fake a tall note (real content would need dozens of slow individual
    // keystrokes through this driver — see create-note.e2e.ts's known
    // per-command overhead) — the bug under test is pure scroll/CSS
    // behavior, indifferent to whether the height comes from real
    // paragraphs or a spacer.
    await browser.execute(() => {
      const pane = document.querySelector('.editor-pane')
      if (!(pane instanceof HTMLElement)) throw new Error('no .editor-pane')
      pane.style.minHeight = '3000px'
    })

    // Focus before scrolling: focusing a contenteditable root snaps the
    // scroll container back to the caret, which would otherwise silently
    // undo the scrollTop set below.
    await browser.execute(() => {
      const el = document.querySelector('.ProseMirror')
      if (el instanceof HTMLElement) el.focus()
    })
    await browser.execute(() => {
      const scroller = document.querySelector('.editor-scroll')
      if (!(scroller instanceof HTMLElement)) throw new Error('no .editor-scroll')
      scroller.scrollTop = 800
    })

    await browser.keys(['Control', 'f'])
    await browser.keys(['Control'])

    await browser.waitUntil(
      async () => browser.execute(() => document.querySelector('.note-find-bar')?.hidden === false),
      { timeout: 5000, timeoutMsg: '.note-find-bar never opened after Ctrl+F' },
    )

    await screenshot('note-find-bar-mid-scroll')

    const state = await browser.execute(() => {
      const scroller = document.querySelector('.editor-scroll')
      const bar = document.querySelector('.note-find-bar')
      if (!(scroller instanceof HTMLElement) || !(bar instanceof HTMLElement)) throw new Error('missing element')
      const scrollerRect = scroller.getBoundingClientRect()
      const barRect = bar.getBoundingClientRect()
      return {
        scrollTop: scroller.scrollTop,
        barVisible: barRect.bottom > scrollerRect.top && barRect.top < scrollerRect.bottom,
      }
    })

    // The regression this guards: opening the bar used to silently scroll
    // the whole note back to the top (an unguarded focus() call), and even
    // once that was fixed, the bar itself failed to stay visible on a real
    // scroll because CSS `position: sticky` didn't hold inside this deeply
    // nested contenteditable layout.
    expect(state.scrollTop).toBe(800)
    expect(state.barVisible).toBe(true)
  })
})
