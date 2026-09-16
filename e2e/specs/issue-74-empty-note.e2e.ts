import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { fillPromptDialog } from '../promptDialog.js'
import { screenshot } from '../screenshot.js'

// See create-note.e2e.ts for why in-page clicks are used over WebdriverIO's
// own Element#click().
async function clickInPage(selector: string): Promise<void> {
  await browser.execute((sel) => {
    const el = document.querySelector(sel)
    if (!(el instanceof HTMLElement)) {
      throw new Error(`clickInPage: no element matching ${sel}`)
    }
    el.click()
  }, selector)
}

describe('issue #74: empty note page reads as broken', () => {
  it('shows the placeholder on the empty body paragraph and focuses the editor on a click below the content', async () => {
    const notePath = join(fixtureWorkspace, 'Empty Note Test.md')
    rmSync(notePath, { force: true })

    await clickInPage('.sidebar-new-actions button')
    await fillPromptDialog('Empty Note Test')
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.ProseMirror')), {
      timeout: 5000,
      timeoutMsg: 'editor never mounted for the new note',
    })

    // Move the cursor off the title heading and into the body paragraph,
    // same as create-note.e2e.ts — a fresh note starts with the cursor in
    // the H1.
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
    await browser.keys(['End', 'Enter'])

    // Cause (1): the body paragraph should be flagged empty and carry the
    // placeholder text, even though the note already has an H1 title.
    const placeholder = await browser.execute(() => {
      const p = document.querySelector('.note-editor .ProseMirror p.is-empty')
      if (!(p instanceof HTMLElement)) return null
      return {
        dataPlaceholder: p.getAttribute('data-placeholder'),
        beforeContent: getComputedStyle(p, '::before').content,
      }
    })
    expect(placeholder).not.toBeNull()
    expect(placeholder?.dataPlaceholder).toBe('Start writing…')
    expect(placeholder?.beforeContent).toBe('"Start writing…"')

    await screenshot('issue-74-empty-note-placeholder')

    // Cause (5): clicking the empty region below the content (inside
    // .editor-pane but below where the note content itself used to end)
    // should still focus the editor rather than landing on dead space.
    await browser.execute(() => {
      const el = document.querySelector('.ProseMirror')
      if (el instanceof HTMLElement) el.blur()
    })
    expect(await browser.execute(() => document.activeElement?.className)).not.toContain('ProseMirror')

    await browser.execute(() => {
      const scroll = document.querySelector('.editor-scroll')
      const pane = document.querySelector('.editor-pane')
      if (!(scroll instanceof HTMLElement) || !(pane instanceof HTMLElement)) {
        throw new Error('editor-scroll or editor-pane not found')
      }
      const rect = pane.getBoundingClientRect()
      // Click near the bottom of .editor-pane's own box — well below the
      // short title+empty-paragraph content, in what used to be dead space.
      const x = rect.left + rect.width / 2
      const y = rect.top + rect.height - 20
      const target = document.elementFromPoint(x, y)
      target?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y }))
      target?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y }))
      target?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }))
    })

    await browser.waitUntil(
      async () => browser.execute(() => document.activeElement?.classList.contains('ProseMirror') ?? false),
      { timeout: 3000, timeoutMsg: 'clicking below the note content never focused the editor' },
    )
  })
})
