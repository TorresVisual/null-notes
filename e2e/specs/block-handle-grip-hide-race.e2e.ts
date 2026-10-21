import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { browser } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { fillPromptDialog } from '../promptDialog.js'
import { clickNewMenuItem } from '../sidebar.js'

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

// Regression coverage for a bug where the block-handle grip would hide
// itself mid-approach and stay unclickable: `.drag-handle` (the grip's
// portal) renders as a sibling of the editor DOM, outside its own
// hoverable bounding box. Moving the cursor from a row toward the grip
// means crossing that boundary — and at the exact crossing pixel, native
// hit-testing resolves to `.editor-pane` (behind the grip), not the grip
// itself, so the library's own mouseleave guard hides it (and clears our
// selection state) right as the cursor arrives, before a click can land.
// A single fast jump to the grip's coordinates (as in
// block-handle-long-list.e2e.ts) never exercises this — it requires a
// slow, many-waypoint approach like a real hand-driven mouse.
describe('block handle grip: hide race on approach', () => {
  it('stays visible and clickable through a slow multi-waypoint approach', async () => {
    const title = `block-handle-grip-race-${Date.now()}`
    const notePath = join(fixtureWorkspace, `${title}.md`)
    rmSync(notePath, { force: true })

    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.sidebar-new')), {
      timeout: 10000,
      timeoutMsg: 'sidebar never rendered',
    })
    await clickNewMenuItem('Note')
    await fillPromptDialog(title)
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.ProseMirror')), {
      timeout: 5000,
      timeoutMsg: 'editor never mounted for the new note',
    })
    // First interaction in a freshly launched process pays a one-time
    // render/JIT warmup cost (see e2e-verify's known gotchas) — settle
    // before the first keystroke rather than racing it.
    await browser.pause(1500)

    await focusEditorEnd()
    await browser.keys(['End', 'Enter'])
    await browser.keys('[ ] first task item')
    await browser.pause(300)
    await browser.keys(['Enter'])
    await browser.keys('second task item')
    await browser.pause(500)

    const rowRect = await browser.execute(() => {
      const items = document.querySelectorAll('.ProseMirror ul[data-type="taskList"] li')
      const el = items[items.length - 1]
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { left: r.left, top: r.top, width: r.width, height: r.height }
    })
    if (!rowRect) throw new Error('row not found')
    const rowY = Math.round(rowRect.top + rowRect.height / 2)

    // Hover the row to reveal the grip and learn where it renders.
    await browser.action('pointer').move({ duration: 150, x: Math.round(rowRect.left + 30), y: rowY }).perform()
    await browser.pause(300)
    const gripRect = await browser.execute(() => {
      const grip = document.querySelector('.block-handle-grip')
      if (!grip) return null
      const r = grip.getBoundingClientRect()
      return { left: r.left, top: r.top, width: r.width, height: r.height }
    })
    if (!gripRect) throw new Error('grip not found')
    const gripCenterX = Math.round(gripRect.left + gripRect.width / 2)
    const gripCenterY = Math.round(gripRect.top + gripRect.height / 2)

    // A slow, 15-waypoint diagonal approach from well inside the row text
    // toward the grip's center — much closer to a real hand-driven mouse
    // than a single interpolated jump.
    const startX = Math.round(rowRect.left + 60)
    const steps = 15
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const x = Math.round(startX + (gripCenterX - startX) * t)
      const y = Math.round(rowY + (gripCenterY - rowY) * t)
      await browser.action('pointer').move({ duration: 60, x, y }).perform()
    }

    await browser.pause(200)
    const finalState = await browser.execute(() => {
      const grip = document.querySelector('.block-handle-grip')
      if (!grip) return null
      return { visibility: window.getComputedStyle(grip).visibility }
    })
    if (!finalState || finalState.visibility === 'hidden') {
      throw new Error('grip is hidden after a slow approach — hide race regressed')
    }

    // Click at the grip's ACTUAL current position — edge detection can
    // legitimately retarget the grip from the row to its enclosing list
    // partway through the approach, so this isn't necessarily where the
    // approach's own path was originally aimed.
    const currentGripRect = await browser.execute(() => {
      const grip = document.querySelector('.block-handle-grip')
      if (!grip) return null
      const r = grip.getBoundingClientRect()
      return { left: r.left, top: r.top, width: r.width, height: r.height }
    })
    if (!currentGripRect) throw new Error('grip missing before click')
    const clickX = Math.round(currentGripRect.left + currentGripRect.width / 2)
    const clickY = Math.round(currentGripRect.top + currentGripRect.height / 2)

    await browser.action('pointer').move({ duration: 0, x: clickX, y: clickY }).down().pause(50).up().perform()
    await browser.pause(300)
    const menuOpen = await browser.execute(() => !!document.querySelector('.block-handle-menu'))
    if (!menuOpen) throw new Error('menu did not open after a real click following the slow approach')
  })
})
