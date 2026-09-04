import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { browser } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { fillPromptDialog } from '../promptDialog.js'
import { screenshot } from '../screenshot.js'

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

// Regression coverage for a bug where BlockHandle's DragHandle (nested:
// false, the library default) tracked an entire list as one undifferentiated
// top-level block — the grip centered on the whole list's bounding box, not
// the hovered row. Invisible on a 2-3 item example list, badly broken on a
// real multi-item checklist: hovering the first row put the grip screens
// away, reading as "the grip doesn't appear at all."
describe('block handle on a long task list', () => {
  it('tracks the hovered row instead of centering on the whole list', async () => {
    const title = `block-handle-long-list-${Date.now()}`
    const notePath = join(fixtureWorkspace, `${title}.md`)
    rmSync(notePath, { force: true })

    await clickInPage('.sidebar-new-actions button')
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
    await browser.keys('[ ] item 1')
    await browser.pause(300)
    for (let i = 2; i <= 20; i++) {
      await browser.keys(['Enter'])
      await browser.keys(`item ${i}`)
    }
    await browser.pause(500)

    const rows = await browser.execute(() => {
      const items = Array.from(document.querySelectorAll('.ProseMirror ul[data-type="taskList"] li'))
      return items.map((el) => {
        const r = el.getBoundingClientRect()
        return { top: r.top, height: r.height }
      })
    })
    expect(rows.length).toBe(20)

    async function gripTopWhenHovering(rowIndex: number): Promise<number | null> {
      const row = rows[rowIndex]
      if (!row) throw new Error(`row ${rowIndex} not found`)
      await browser
        .action('pointer')
        .move({ duration: 150, x: 420, y: Math.round(row.top + row.height / 2) })
        .perform()
      await browser.pause(300)
      return browser.execute(() => document.querySelector('.drag-handle')?.getBoundingClientRect().top ?? null)
    }

    for (const rowIndex of [0, 10, 19]) {
      const row = rows[rowIndex]
      if (!row) throw new Error(`row ${rowIndex} not found`)
      const gripTop = await gripTopWhenHovering(rowIndex)
      expect(gripTop).not.toBeNull()
      // Tolerance is a row's own height, not pixel-exact — floating-ui
      // centers the grip vertically against the row, so it lands a few
      // pixels off the row's own top edge. The bug this guards against put
      // the grip ~300px away on a 20-item list; a row-sized tolerance still
      // clearly distinguishes "tracks the row" from "centers on the list."
      expect(Math.abs((gripTop as number) - row.top)).toBeLessThan(row.height)
    }

    await screenshot('block-handle-long-list-hover-last-row')

    // The whole list must still be reachable — but only right at its own
    // top/bottom boundary (edgeDetection's 'top'/'bottom' edges), not
    // anywhere along a row's left gutter: that x-only check fired for every
    // row regardless of height, which is what made individual row grips
    // unreachable (see BlockHandle.tsx's NESTED_LIST_DRAG_HANDLE_OPTIONS
    // comment). Hovering within a few px of the first row's own top edge —
    // which coincides with the whole list's top edge — still resolves to
    // the list.
    const firstRow = rows[0]
    if (!firstRow) throw new Error('row 0 missing')
    const firstRowLeft = await browser.execute(
      () => document.querySelector('.ProseMirror ul[data-type="taskList"] li')?.getBoundingClientRect().left ?? null,
    )
    expect(firstRowLeft).not.toBeNull()
    await browser
      .action('pointer')
      .move({ duration: 150, x: Math.round((firstRowLeft as number) + 3), y: Math.round(firstRow.top + 5) })
      .perform()
    await browser.pause(300)
    await clickInPage('.block-handle-grip')
    await browser.pause(200)

    const menuItems = await browser.execute(() =>
      Array.from(document.querySelectorAll('.block-handle-menu-item')).map((el) => el.textContent),
    )
    expect(menuItems.some((t) => t?.includes('Reorder tasks'))).toBe(true)
    await screenshot('block-handle-long-list-menu-open')
  })
})
