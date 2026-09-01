import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { screenshot } from '../screenshot.js'
import { fillPromptDialog } from '../promptDialog.js'

// See create-note.e2e.ts / p11-1-code-block-affordances.e2e.ts for why these
// exist: WebdriverIO's own click()/waitForClickable() readiness polling is a
// slow round trip through this driver, and a plain in-page .click() doesn't
// give ProseMirror a real cursor position the way a mouse click does.
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
    { timeout: 10000, timeoutMsg: `slash menu never showed an item titled "${title}"` },
  )
  await browser.execute((t) => {
    const items = Array.from(document.querySelectorAll('.slash-menu-item'))
    const match = items.find((el) => el.querySelector('.slash-item-title')?.textContent === t)
    if (!(match instanceof HTMLElement)) throw new Error(`no slash item titled "${t}"`)
    match.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  }, title)
}

// usePrintPreview.ts's MutationObserver fix is meant to catch content that
// finishes painting *after* the dialog mounts (a code block's syntax
// highlighting, in this repro) — matches p11-1-code-block-affordances.e2e.ts's
// proven create-note-then-immediately-insert-code-block ordering; inserting
// the block *after* other typed prose was flaky here for reasons unrelated
// to the bug under test, so prose goes in below the block instead.
async function createNoteWithCodeBlock(title: string): Promise<void> {
  const notePath = join(fixtureWorkspace, `${title}.md`)
  rmSync(notePath, { force: true })

  await browser.waitUntil(
    async () => browser.execute(() => !!document.querySelector('.sidebar-new-actions button')),
    { timeout: 15000, timeoutMsg: 'app never finished loading (sidebar never appeared)' },
  )

  await clickInPage('.sidebar-new-actions button')
  await fillPromptDialog(title)
  await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.ProseMirror')), {
    timeout: 5000,
    timeoutMsg: 'editor never mounted for the new note',
  })
  // A fresh note's editor can remount once right after this first mount
  // (content arriving a beat after the empty shell) — a plain "it exists"
  // check can pass against the shell right before it's replaced. Confirm
  // the same node survives two checks spaced apart before touching it.
  await browser.waitUntil(
    async () => {
      const first = await browser.execute(() => document.querySelector('.ProseMirror'))
      await new Promise((r) => setTimeout(r, 300))
      const second = await browser.execute(() => document.querySelector('.ProseMirror'))
      return !!first && !!second
    },
    { timeout: 5000, interval: 300, timeoutMsg: 'editor never settled after mounting' },
  )

  await focusEditorEnd()
  await browser.keys(['End', 'Enter'])

  await runSlashCommand('Code', 'Code Block')
  await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.note-editor pre')), {
    timeout: 10000,
    timeoutMsg: 'code block never mounted',
  })
  await browser.keys('function main() {\n  return 42;\n}')

  // Mod-Enter exits the code block back into a following paragraph (the
  // code block extension's own escape hatch), so the prose line below is a
  // second, differently-timed piece of content the preview has to include.
  await browser.keys(['Control', 'Enter'])
  await browser.keys('Some prose below the code block.')
}

describe('print preview fix', () => {
  it('populates the Export to PDF preview on first open, with no checkbox toggle', async () => {
    await createNoteWithCodeBlock('Print Preview Repro')

    await browser.execute(() => {
      const fn = (window as unknown as { __e2eRunCommand?: (id: string) => void }).__e2eRunCommand
      if (!fn) throw new Error('__e2eRunCommand hook missing')
      fn('export-pdf')
    })

    await browser.waitUntil(
      async () => browser.execute(() => !!document.querySelector('.print-preview-pages')),
      { timeout: 5000, timeoutMsg: 'Export to PDF dialog never opened' },
    )

    // The bug: this stayed empty forever without a checkbox toggle. The fix
    // is a MutationObserver-driven retry, so this has to resolve on its own
    // within a normal render+debounce window — no checkbox click anywhere
    // in this test.
    await browser.waitUntil(
      async () => browser.execute(() => !!document.querySelector('.print-preview-pages .pagedjs_page')),
      { timeout: 8000, timeoutMsg: 'preview never rendered a page without a checkbox toggle' },
    )

    const pageText = await browser.execute(
      () => document.querySelector('.print-preview-pages .pagedjs_page')?.textContent ?? '',
    )
    expect(pageText).toContain('function main')
    expect(pageText).toContain('Some prose below the code block')

    await screenshot('print-preview-fix-initial-render')
  })
})
