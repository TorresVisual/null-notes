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

// Regression coverage for a bug where a task list's own row grips were
// unreachable except for whichever row sat nearest the list's vertical
// middle: DragHandle's edge-detection scored every list item's own left
// gutter (where the grip renders) as "near the parent list's edge" too,
// and a depth-2 item's penalty exactly zeroed its score, excluding it
// outright — so approaching any row's grip re-resolved to the whole list
// instead. See BlockHandle.tsx's NESTED_LIST_DRAG_HANDLE_OPTIONS comment.
describe('block handle on a checklist with checked rows', () => {
  it('opens a per-row menu for the first, a checked-middle, and the last row', async () => {
    const title = `block-handle-checked-rows-${Date.now()}`
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
    await browser.pause(1500)

    await focusEditorEnd()
    await browser.keys(['End', 'Enter'])
    await browser.keys('[ ] item 1')
    await browser.pause(300)
    for (let i = 2; i <= 6; i++) {
      await browser.keys(['Enter'])
      await browser.keys(`item ${i}`)
    }
    await browser.pause(500)

    for (const idx of [0, 2, 4]) {
      await browser.execute((i) => {
        const boxes = document.querySelectorAll('.ProseMirror ul[data-type="taskList"] li input[type="checkbox"]')
        const box = boxes[i] as HTMLInputElement | undefined
        box?.click()
      }, idx)
      await browser.pause(150)
    }
    await browser.pause(500)

    const rows = await browser.execute(() => {
      const items = Array.from(document.querySelectorAll('.ProseMirror ul[data-type="taskList"] li'))
      return items.map((el) => {
        const r = el.getBoundingClientRect()
        return { top: r.top, left: r.left, height: r.height }
      })
    })
    expect(rows.length).toBe(6)

    // First (checked), a checked middle row, and the last (unchecked) row —
    // the exact set the reported bug made unreachable except by luck.
    for (const rowIndex of [0, 2, 5]) {
      const row = rows[rowIndex]
      if (!row) throw new Error(`row ${rowIndex} missing`)

      // Hover the row's own text to establish it as the tracked node.
      await browser
        .action('pointer')
        .move({ duration: 150, x: Math.round(row.left + 30), y: Math.round(row.top + row.height / 2) })
        .perform()
      await browser.pause(300)

      const gripRect = await browser.execute(() => {
        const g = document.querySelector('.block-handle-grip')
        if (!g) return null
        const r = g.getBoundingClientRect()
        return { left: r.left, top: r.top, width: r.width, height: r.height }
      })
      if (!gripRect) throw new Error(`row ${rowIndex}: grip not found`)

      // Move from the row's text to the grip's own position, several
      // waypoints — a real approach, not a teleport — then click it.
      const steps = 8
      const fromX = Math.round(row.left + 30)
      const fromY = Math.round(row.top + row.height / 2)
      const toX = Math.round(gripRect.left + gripRect.width / 2)
      const toY = Math.round(gripRect.top + gripRect.height / 2)
      for (let i = 1; i <= steps; i++) {
        const t = i / steps
        await browser
          .action('pointer')
          .move({ duration: 25, x: Math.round(fromX + (toX - fromX) * t), y: Math.round(fromY + (toY - fromY) * t) })
          .perform()
      }
      await browser.pause(200)

      const currentGrip = await browser.execute(() => {
        const g = document.querySelector('.block-handle-grip')
        if (!g) return null
        const r = g.getBoundingClientRect()
        return { left: r.left, top: r.top, width: r.width, height: r.height }
      })
      if (!currentGrip) throw new Error(`row ${rowIndex}: grip missing before click`)
      const clickX = Math.round(currentGrip.left + currentGrip.width / 2)
      const clickY = Math.round(currentGrip.top + currentGrip.height / 2)

      // The fixed bug: the grip would have drifted away from this row's own
      // band toward the list's vertical center. Clicking wherever it
      // actually reports itself must still land on THIS row, not the list.
      expect(Math.abs(clickY - (row.top + row.height / 2))).toBeLessThan(row.height)

      await browser.action('pointer').move({ duration: 0, x: clickX, y: clickY }).down().pause(30).up().perform()
      await browser.pause(200)
      const menuItems = await browser.execute(() =>
        Array.from(document.querySelectorAll('.block-handle-menu-item')).map((el) => el.textContent),
      )
      if (menuItems.length === 0) throw new Error(`row ${rowIndex}: menu did not open`)
      // "Reorder tasks" acts on the row's enclosing list even when a single
      // row is selected (see resolveTaskList in BlockHandle.tsx) — it no
      // longer depends on the hard-to-hit edge-of-the-whole-list gesture.
      expect(menuItems.some((t) => t?.includes('Reorder tasks'))).toBe(true)

      // Close the menu before moving to the next row.
      await browser.action('pointer').move({ duration: 0, x: 700, y: 700 }).down().pause(20).up().perform()
      await browser.pause(150)
    }
  })
})
