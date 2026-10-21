import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { fillPromptDialog } from '../promptDialog.js'
import { clickNewMenuItem } from '../sidebar.js'

// WebdriverIO's Element#click() runs its own overlap/visibility readiness
// check before clicking — see sidebar.ts's clickInPage for why this
// project always dispatches clicks as plain in-page JS instead.
async function clickInPage(selector: string): Promise<void> {
  await browser.execute((sel) => {
    const el = document.querySelector(sel)
    if (!(el instanceof HTMLElement)) throw new Error(`clickInPage: no element matching ${sel}`)
    el.click()
  }, selector)
}

async function setPaneMinHeight(px: number): Promise<void> {
  await browser.execute((height) => {
    const pane = document.querySelector('.editor-pane')
    if (!(pane instanceof HTMLElement)) throw new Error('no .editor-pane')
    pane.style.minHeight = `${height}px`
  }, px)
}

async function readScrollState(): Promise<{ scrollTop: number; scrollable: number; fraction: number }> {
  return browser.execute(() => {
    const scroller = document.querySelector('.editor-scroll')
    if (!(scroller instanceof HTMLElement)) throw new Error('no .editor-scroll')
    const scrollable = scroller.scrollHeight - scroller.clientHeight
    return { scrollTop: scroller.scrollTop, scrollable, fraction: scrollable > 0 ? scroller.scrollTop / scrollable : 0 }
  })
}

// Regression test for #31: switching between the rendered and raw view used
// to carry over one absolute pixel scrollTop, which meant nothing once the
// other view laid the same note out at a completely different height. The
// fix restores a 0..1 fraction of the scrollable height instead — this pins
// that behaviour by giving the two views genuinely different heights (via
// `.editor-pane`, which survives the view swap unlike its child) and
// checking the *fraction* survives even though the pixel offset can't.
describe('scroll position sync between rendered and raw view (#31)', () => {
  it('lands at the same relative depth, not the same pixel offset or the top', async () => {
    const notePath = join(fixtureWorkspace, 'Scroll Sync Toggle.md')
    rmSync(notePath, { force: true })

    await clickNewMenuItem('Note')
    await fillPromptDialog('Scroll Sync Toggle')
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.ProseMirror')), {
      timeout: 5000,
      timeoutMsg: 'editor never mounted for the new note',
    })

    // The viewport's own clientHeight sets a floor below which a pane isn't
    // scrollable at all — deriving both fake heights from it (rather than
    // guessing fixed pixel values) guarantees the "short" raw layout below
    // still has room to scroll, whatever this driver's window size is.
    const clientHeight = await browser.execute(() => {
      const scroller = document.querySelector('.editor-scroll')
      if (!(scroller instanceof HTMLElement)) throw new Error('no .editor-scroll')
      return scroller.clientHeight
    })
    const tallPx = clientHeight * 6
    const shortPx = clientHeight * 3

    // Fake a tall wysiwyg layout and scroll to its midpoint — real content
    // would need dozens of slow individual keystrokes through this driver
    // (see create-note.e2e.ts), and the bug under test is pure scroll
    // geometry, indifferent to whether the height comes from real paragraphs
    // or a spacer.
    await browser.execute(() => {
      const el = document.querySelector('.ProseMirror')
      if (el instanceof HTMLElement) el.focus()
    })
    await setPaneMinHeight(tallPx)
    const wysiwyg = await browser.execute(() => {
      const scroller = document.querySelector('.editor-scroll')
      if (!(scroller instanceof HTMLElement)) throw new Error('no .editor-scroll')
      const scrollable = scroller.scrollHeight - scroller.clientHeight
      scroller.scrollTop = Math.round(scrollable / 2)
      // Real scroll events land asynchronously; the hook's listener only
      // needs the event to have fired at all, so dispatch it inline instead
      // of waiting a tick.
      scroller.dispatchEvent(new Event('scroll'))
      return { scrollTop: scroller.scrollTop, scrollable }
    })
    expect(wysiwyg.scrollable).toBeGreaterThan(0)

    // Shrink the pane before switching — .editor-pane is not remounted by
    // the view toggle, so this simulates "the raw view lays the note out
    // much shorter" without racing an async resize/clamp event.
    await setPaneMinHeight(shortPx)
    await clickInPage('.view-toggle')
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.raw-editor')), {
      timeout: 5000,
      timeoutMsg: 'view toggle never switched to raw view',
    })

    const raw = await readScrollState()

    // Not reset to the top (the original bug) and not the wysiwyg view's raw
    // pixel value either (a shorter pane can't even hold it) — the fraction
    // through the (much shorter) raw layout should still read ~0.5.
    expect(raw.scrollable).toBeGreaterThan(0)
    expect(raw.scrollTop).toBeGreaterThan(0)
    expect(raw.scrollTop).toBeLessThan(wysiwyg.scrollTop)
    expect(raw.fraction).toBeGreaterThan(0.4)
    expect(raw.fraction).toBeLessThan(0.6)

    // Grow the pane back before switching back, mirroring the shrink above.
    await setPaneMinHeight(tallPx)
    await clickInPage('.view-toggle')
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.ProseMirror')), {
      timeout: 5000,
      timeoutMsg: 'view toggle never switched back to wysiwyg view',
    })

    const backToWysiwyg = await readScrollState()

    expect(backToWysiwyg.fraction).toBeGreaterThan(0.4)
    expect(backToWysiwyg.fraction).toBeLessThan(0.6)
  })
})
