import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'
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

async function clickButtonByText(selector: string, text: string): Promise<void> {
  await browser.execute(
    (sel, t) => {
      const btn = Array.from(document.querySelectorAll(sel)).find((el) => el.textContent?.includes(t))
      if (!(btn instanceof HTMLElement)) throw new Error(`no ${sel} with text "${t}"`)
      btn.click()
    },
    selector,
    text,
  )
}

async function focusEditorEnd(): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute(() => {
        const el = document.querySelector('.ProseMirror')
        if (!(el instanceof HTMLElement)) return false
        el.focus()
        const range = document.createRange()
        range.selectNodeContents(el)
        range.collapse(false)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
        return document.activeElement === el
      }),
    { timeout: 5000, interval: 100, timeoutMsg: 'the ProseMirror editor never accepted focus' },
  )
}

async function createNote(title: string): Promise<string> {
  const notePath = join(fixtureWorkspace, `${title}.md`)
  rmSync(notePath, { force: true })

  await clickButtonByText('.sidebar-new-actions button', 'Note')
  await fillPromptDialog(title)
  await focusEditorEnd()
  await browser.keys(['End', 'Enter'])
  return notePath
}

async function waitForSavedContent(notePath: string, needle: string): Promise<string> {
  await browser.waitUntil(
    () => existsSync(notePath) && readFileSync(notePath, 'utf-8').includes(needle),
    { timeout: 10000, interval: 300, timeoutMsg: `${notePath} never contained "${needle}"` },
  )
  return readFileSync(notePath, 'utf-8')
}

describe('issue #19: free-text search jumps to and highlights the match', () => {
  it('scrolls to and highlights the match after clicking a free-text search result', async () => {
    const notePath = await createNote('Search Highlight Repro')
    await browser.keys('zzsearchneedle marks the spot')
    await waitForSavedContent(notePath, 'zzsearchneedle marks the spot')
    await browser.pause(4000) // let FTS reindex land (REINDEX_DEBOUNCE_MS)

    // Navigate away so the note isn't already the active tab/scroll position.
    await createNote('Other Note To Switch Away')

    await clickButtonByText('.sidebar-nav-btn', 'Search')
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.search-modal-input')), {
      timeout: 5000,
      timeoutMsg: 'search modal never opened',
    })
    await browser.keys('zzsearchneedle')
    await browser.waitUntil(
      async () =>
        browser.execute(() =>
          Array.from(document.querySelectorAll('.search-result-title')).some(
            (el) => el.textContent === 'Search Highlight Repro',
          ),
        ),
      { timeout: 10000, interval: 300, timeoutMsg: 'free-text query never surfaced the note' },
    )

    await clickInPage('.search-result')
    await browser.waitUntil(
      async () =>
        browser.execute(() => document.querySelector('.tab.active button')?.textContent === 'Search Highlight Repro'),
      { timeout: 5000, timeoutMsg: 'clicking the result never switched tabs' },
    )

    const gotHighlight = await browser.waitUntil(
      async () => browser.execute(() => !!document.querySelector('.search-jump-target')),
      { timeout: 3000, interval: 100, timeoutMsg: 'no .search-jump-target ever appeared' },
    ).then(() => true, () => false)

    await screenshot('issue-19-search-highlight-repro')
    expect(gotHighlight).toBe(true)
  })
})
