import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect, $ } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { screenshot } from '../screenshot.js'
import { fillPromptDialog } from '../promptDialog.js'
import { clickNewMenuItem } from '../sidebar.js'
import { clickInsertMenuItem } from '../insertMenu.js'

async function clickInPage(selector: string): Promise<void> {
  await browser.execute((sel) => {
    const el = document.querySelector(sel)
    if (!(el instanceof HTMLElement)) throw new Error(`clickInPage: no element matching ${sel}`)
    el.click()
  }, selector)
}

// Menu-item and append/corner buttons listen for mousedown (not click) so
// the browser never steals focus/selection out of the table before the
// handler runs — dispatch the same event a real mouse would send. The grip
// summary itself is a real <details>/<summary> toggle, so opening a menu
// uses a genuine click (clickInPage) instead.
async function mousedownInPage(selector: string): Promise<void> {
  await browser.execute((sel) => {
    const el = document.querySelector(sel)
    if (!(el instanceof HTMLElement)) throw new Error(`mousedownInPage: no element matching ${sel}`)
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  }, selector)
}

// `clickInPage`/`mousedownInPage` call DOM methods directly, which bypass
// hit-testing entirely — they'd happily "click" an element sitting under a
// `pointer-events: none` ancestor that a real mouse could never reach.
// `elementFromPoint` is what a real click actually resolves against, so
// this is the only way to catch that class of bug (see the grip's own
// pointer-events regression this guards against).
async function isHitTestable(selector: string): Promise<boolean> {
  return browser.execute((sel) => {
    const el = document.querySelector(sel)
    if (!(el instanceof HTMLElement)) throw new Error(`isHitTestable: no element matching ${sel}`)
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return hit !== null && el.contains(hit)
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
  await browser.waitUntil(() => existsSync(notePath) && readFileSync(notePath, 'utf-8').includes(needle), {
    timeout: 10000,
    interval: 300,
    timeoutMsg: `${notePath} never contained "${needle}"`,
  })
  return readFileSync(notePath, 'utf-8')
}

describe('table row/column grip menus', () => {
  it('deletes a column via its grip menu and adds a row via the persistent append control', async () => {
    const notePath = await createNote('Table Controls')

    await clickInsertMenuItem('Table')
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.note-editor table')), {
      timeout: 5000,
      timeoutMsg: 'table never mounted',
    })

    await browser.execute(() => {
      const cell = document.querySelector('.note-editor th p')
      if (!(cell instanceof HTMLElement)) throw new Error('no header cell paragraph')
      cell.focus()
      const range = document.createRange()
      range.selectNodeContents(cell)
      range.collapse(false)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    })
    await browser.keys('Seed')
    await waitForSavedContent(notePath, 'Seed')

    // Real :hover state (not a synthetic dispatched event) so the grip
    // overlay is actually visible for the screenshot.
    await $('.note-editor .tableWrapper').moveTo()
    await screenshot('table-controls-hover')

    // A real mouse click has to actually land on these — not just find them
    // in the DOM (see isHitTestable above).
    expect(await isHitTestable('.table-col-menu[data-col-index="0"] > summary')).toBe(true)
    expect(await isHitTestable('.table-row-menu[data-row-index="0"] > summary')).toBe(true)
    expect(await isHitTestable('.table-append-col')).toBe(true)
    expect(await isHitTestable('.table-append-row')).toBe(true)
    expect(await isHitTestable('.table-controls-corner')).toBe(true)

    const colsBefore = await browser.execute(
      () => document.querySelectorAll('.note-editor tr:first-child > th').length,
    )
    expect(colsBefore).toBe(3)

    await clickInPage('.table-col-menu[data-col-index="1"] > summary')
    await mousedownInPage('.table-col-menu[data-col-index="1"] [data-action="delete"]')
    await browser.waitUntil(
      async () =>
        (await browser.execute(() => document.querySelectorAll('.note-editor tr:first-child > th').length)) === 2,
      { timeout: 5000, timeoutMsg: 'column was never removed' },
    )

    const rowsBefore = await browser.execute(() => document.querySelectorAll('.note-editor tr').length)
    await mousedownInPage('.table-append-row')
    await browser.waitUntil(
      async () => (await browser.execute(() => document.querySelectorAll('.note-editor tr').length)) === rowsBefore + 1,
      { timeout: 5000, timeoutMsg: 'row was never appended' },
    )

    await $('.note-editor .tableWrapper').moveTo()
    await screenshot('table-controls-after-edit')
  })
})
