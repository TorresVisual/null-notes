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

describe('P6-7: cross-references', () => {
  it('makes "Theorem 3.2" clickable once a matching numbered block exists, and jumps to it', async () => {
    // Callout title/number have no dedicated edit control yet (P6-1 shipped
    // the attribute and round-trip, not an input for it) — raw/source view
    // is the real, supported way a user sets one today.
    const theoremNotePath = await createNote('P6-7 Theorem Note')
    await clickInPage('.view-toggle')
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.raw-editor')), {
      timeout: 5000,
      timeoutMsg: 'raw editor never opened',
    })
    await browser.execute(() => {
      const el = document.querySelector('.raw-editor') as HTMLTextAreaElement
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(el, '# P6-7 Theorem Note\n\n> [!THEOREM 3.2] Squeeze Theorem\n> The limit is squeezed between two bounds.\n')
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await waitForSavedContent(theoremNotePath, '[!THEOREM 3.2] Squeeze Theorem')

    // A cross-reference is resolved (and the answer cached — see CrossRef.ts)
    // against the FTS index, not the file directly, and the reindex that
    // fills it in lags the save by its own coarser debounce (REINDEX_DEBOUNCE_MS,
    // 2.5s — CLAUDE.md's save-path section). Typing the reference before that
    // completes would cache a permanent "not found" for this run, since
    // nothing re-asks once the doc stops changing. Switching tabs is
    // documented to flush the pending reindex, but not to wait for it —
    // give it the debounce plus margin before referencing the block.
    const referenceNotePath = await createNote('P6-7 Reference Note')
    await browser.pause(4000)
    await browser.keys('See Theorem 3.2 for details.')
    await waitForSavedContent(referenceNotePath, 'See Theorem 3.2 for details.')

    await browser.waitUntil(
      async () => browser.execute(() => !!document.querySelector('.cross-ref:not(.cross-ref-missing)')),
      { timeout: 15000, interval: 500, timeoutMsg: '"Theorem 3.2" never resolved to a clickable reference' },
    )
    await screenshot('p6-7-cross-ref-resolved')

    await clickInPage('.cross-ref')
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const active = document.querySelector('.tab.active button')
          return active?.textContent === 'P6-7 Theorem Note'
        }),
      { timeout: 5000, timeoutMsg: 'clicking the cross-ref never switched to the defining note' },
    )
    await browser.waitUntil(
      async () =>
        browser.execute(
          () => !!document.querySelector('.callout-theorem[data-callout-number="3.2"]'),
        ),
      { timeout: 5000, timeoutMsg: 'the Theorem 3.2 block never appeared after navigating to it' },
    )
    await screenshot('p6-7-cross-ref-jumped')
  })

  it('leaves an unresolvable reference inert', async () => {
    const notePath = await createNote('P6-7 Unresolved Reference')
    await browser.keys('See Theorem 9.9 for details.')
    await waitForSavedContent(notePath, 'See Theorem 9.9 for details.')

    await browser.waitUntil(
      async () => browser.execute(() => !!document.querySelector('.cross-ref.cross-ref-missing')),
      { timeout: 15000, interval: 500, timeoutMsg: 'an unresolvable reference was never marked inert' },
    )

    const activeBefore = await browser.execute(() => document.querySelector('.tab.active button')?.textContent)
    await clickInPage('.cross-ref-missing')
    await browser.pause(500)
    const activeAfter = await browser.execute(() => document.querySelector('.tab.active button')?.textContent)
    expect(activeAfter).toBe(activeBefore)
  })
})

describe('P6-5: scoped search', () => {
  it('narrows results with type:/tag: and records a recent search', async () => {
    const notePath = await createNote('P6-5 Tagged Note')
    await browser.keys('graph theory notes #e2esearchtag')
    await waitForSavedContent(notePath, '#e2esearchtag')
    // Let the (separately debounced) tag/FTS reindex land before searching —
    // same REINDEX_DEBOUNCE_MS (2.5s) margin as the cross-ref test above.
    await browser.pause(4000)

    await clickButtonByText('.search-open-btn', 'Search')
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.search-modal-input')), {
      timeout: 5000,
      timeoutMsg: 'search modal never opened',
    })

    await browser.keys('type:theorem')
    await browser.waitUntil(
      async () =>
        browser.execute(() =>
          Array.from(document.querySelectorAll('.search-result-title')).some(
            (el) => el.textContent === 'P6-7 Theorem Note',
          ),
        ),
      { timeout: 10000, interval: 300, timeoutMsg: 'type:theorem never surfaced the theorem note' },
    )
    const typeResultTitles = await browser.execute(() =>
      Array.from(document.querySelectorAll('.search-result-title')).map((el) => el.textContent),
    )
    expect(typeResultTitles).not.toContain('P6-5 Tagged Note')
    await screenshot('p6-5-search-type-filter')

    await browser.execute(() => {
      const input = document.querySelector<HTMLInputElement>('.search-modal-input')
      if (!input) throw new Error('no search input')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await browser.keys('tag:e2esearchtag')
    await browser.waitUntil(
      async () =>
        browser.execute(() =>
          Array.from(document.querySelectorAll('.search-result-title')).some(
            (el) => el.textContent === 'P6-5 Tagged Note',
          ),
        ),
      { timeout: 10000, interval: 300, timeoutMsg: 'tag:e2esearchtag never surfaced the tagged note' },
    )

    // Opening a result records it as a recent search and closes the modal.
    await clickInPage('.search-result')
    await browser.waitUntil(async () => browser.execute(() => !document.querySelector('.search-modal')), {
      timeout: 5000,
      timeoutMsg: 'search modal never closed after opening a result',
    })

    await clickButtonByText('.search-open-btn', 'Search')
    await browser.waitUntil(
      async () =>
        browser.execute(() =>
          Array.from(document.querySelectorAll('.search-recent-item')).some(
            (el) => el.textContent === 'tag:e2esearchtag',
          ),
        ),
      { timeout: 5000, timeoutMsg: 'the recent search was never recorded' },
    )
    await screenshot('p6-5-search-recent')
  })
})
