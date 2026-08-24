import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect, $ } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { screenshot } from '../screenshot.js'
import { fillPromptDialog } from '../promptDialog.js'

async function clickInPage(selector: string): Promise<void> {
  await browser.execute((sel) => {
    const el = document.querySelector(sel)
    if (!(el instanceof HTMLElement)) throw new Error(`clickInPage: no element matching ${sel}`)
    el.click()
  }, selector)
}

async function mousedownInPage(selector: string): Promise<void> {
  await browser.execute((sel) => {
    const el = document.querySelector(sel)
    if (!(el instanceof HTMLElement)) throw new Error(`mousedownInPage: no element matching ${sel}`)
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
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

  await clickInPage('.sidebar-new-actions button')
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

describe('table column alignment persistence', () => {
  it('cycles a column to centered, saves a GFM :---: delimiter, and renders centered text', async () => {
    const notePath = await createNote('Table Alignment')

    await clickInPage('[aria-label="Insert table"]')
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.note-editor table')), {
      timeout: 5000,
      timeoutMsg: 'table never mounted',
    })

    await browser.execute(() => {
      const cell = document.querySelector('.note-editor tr:first-child th:nth-child(2) p')
      if (!(cell instanceof HTMLElement)) throw new Error('no second header cell paragraph')
      cell.focus()
      const range = document.createRange()
      range.selectNodeContents(cell)
      range.collapse(false)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    })
    await browser.keys('Runtime')
    await waitForSavedContent(notePath, 'Runtime')

    await clickInPage('.table-col-menu[data-col-index="1"] > summary')
    await mousedownInPage('.table-col-menu[data-col-index="1"] [data-action="align"]')
    const content = await waitForSavedContent(notePath, ':---:')
    expect(content).toMatch(/\|\s*---\s*\|\s*:---:\s*\|\s*---\s*\|/)

    const textAlign = await browser.execute(() => {
      const cell = document.querySelectorAll('.note-editor tr:first-child th')[1]
      return cell ? window.getComputedStyle(cell).textAlign : null
    })
    expect(textAlign).toBe('center')

    await $('.note-editor .tableWrapper').moveTo()
    await screenshot('table-alignment-centered')
  })
})
