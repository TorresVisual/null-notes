import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { screenshot } from '../screenshot.js'
import { fillPromptDialog } from '../promptDialog.js'
import { clickNewMenuItem } from '../sidebar.js'

// See sidebar.ts for why these two helpers exist.
async function clickInPage(selector: string): Promise<void> {
  await browser.execute((sel) => {
    const el = document.querySelector(sel)
    if (!(el instanceof HTMLElement)) {
      throw new Error(`clickInPage: no element matching ${sel}`)
    }
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

describe('table styling', () => {
  it('centers cell text vertically and visually separates the header row from the zebra stripe', async () => {
    const notePath = await createNote('Table Styling')

    await clickInPage('[aria-label="Insert table"]')
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
    await browser.keys('Header')

    await waitForSavedContent(notePath, 'Header')

    // Table cells default to vertical-align: middle in every browser, but the
    // prose paragraph-spacing rule (`.note-editor p { margin-bottom: 0.6em }`)
    // still applies inside a cell's single paragraph — that trailing margin
    // has no sibling to create space against, so it just throws off centering:
    // the browser centers the paragraph's whole margin box, not the text
    // inside it, so a bottom-only margin visibly pushes the text upward.
    const cellParagraphMarginBottom = await browser.execute(() => {
      const p = document.querySelector('.note-editor td p')
      return p ? window.getComputedStyle(p).marginBottom : null
    })
    expect(cellParagraphMarginBottom).toBe('0px')

    // The header row (tr:nth-child(1)) and the first body row
    // (tr:nth-child(2), which the zebra rule shades) used to share the same
    // background — the header visually fused with the row under it.
    const [headerBg, firstBodyBg] = await browser.execute(() => {
      const th = document.querySelector('.note-editor th')
      const firstBodyCell = document.querySelector('.note-editor tr:nth-child(2) td')
      return [
        th ? window.getComputedStyle(th).backgroundColor : null,
        firstBodyCell ? window.getComputedStyle(firstBodyCell).backgroundColor : null,
      ]
    })
    expect(headerBg).not.toBe(firstBodyBg)

    await screenshot('table-styling')
  })
})
