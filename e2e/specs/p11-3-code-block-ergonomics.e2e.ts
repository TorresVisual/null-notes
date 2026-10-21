import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { screenshot } from '../screenshot.js'
import { fillPromptDialog } from '../promptDialog.js'
import { clickNewMenuItem } from '../sidebar.js'

// See sidebar.ts / p6-academic-blocks.e2e.ts for why these helpers
// exist: WebdriverIO's own click()/waitForClickable() readiness polling is
// a slow round trip through this driver, and a plain in-page .click()
// doesn't give ProseMirror a real cursor position the way a mouse click does.
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
    // 10s, not the usual 5s: the very first slash command in a freshly
    // launched app pays a one-time render/JIT warmup cost later invocations
    // in the same session don't (see e2e-verify's "Known gotchas").
    { timeout: 10000, timeoutMsg: `slash menu never showed an item titled "${title}"` },
  )
  await browser.execute((t) => {
    const items = Array.from(document.querySelectorAll('.slash-menu-item'))
    const match = items.find((el) => el.querySelector('.slash-item-title')?.textContent === t)
    if (!(match instanceof HTMLElement)) throw new Error(`no slash item titled "${t}"`)
    match.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  }, title)
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
  await browser.waitUntil(
    () => existsSync(notePath) && readFileSync(notePath, 'utf-8').includes(needle),
    { timeout: 10000, interval: 300, timeoutMsg: `${notePath} never contained "${needle}"` },
  )
  return readFileSync(notePath, 'utf-8')
}

describe('P11-3: code block editing ergonomics', () => {
  it('Ctrl+F opens in-block search, highlights matches, and Escape closes it', async () => {
    await createNote('P11-3 Search')

    await runSlashCommand('Code', 'Code Block')
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.note-editor pre')), {
      timeout: 5000,
      timeoutMsg: 'code block never mounted',
    })
    await browser.keys('let total = 0;\nlet count = 0;\ntotal += count;')

    await browser.keys(['Control', 'f'])
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.code-search-bar')), {
      timeout: 3000,
      timeoutMsg: 'in-block search bar never opened',
    })

    await browser.execute(() => {
      const input = document.querySelector<HTMLInputElement>('.code-search-input')
      if (!input) throw new Error('no .code-search-input')
      input.value = 'total'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    await browser.waitUntil(
      async () => browser.execute(() => document.querySelectorAll('.code-search-match').length === 2),
      { timeout: 3000, timeoutMsg: 'expected 2 matches for "total"' },
    )

    await screenshot('p11-3-in-block-search')

    await browser.execute(() => {
      document.querySelector<HTMLInputElement>('.code-search-input')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      )
    })
    await browser.waitUntil(async () => browser.execute(() => !document.querySelector('.code-search-bar')), {
      timeout: 3000,
      timeoutMsg: 'search bar never closed on Escape',
    })
  })

  it('folds and unfolds an indented region via the gutter, without touching the saved file', async () => {
    const notePath = await createNote('P11-3 Fold')

    await runSlashCommand('Code', 'Code Block')
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.note-editor pre')), {
      timeout: 5000,
      timeoutMsg: 'code block never mounted',
    })
    await browser.keys('if x:\n    a = 1\n    b = 2\ny = 3')

    const saved = await waitForSavedContent(notePath, 'y = 3')

    await browser.waitUntil(
      async () => browser.execute(() => !!document.querySelector('.code-line-number.foldable')),
      { timeout: 3000, timeoutMsg: 'no foldable line marker ever appeared' },
    )

    await clickInPage('.code-line-number.foldable')
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.code-fold-placeholder')), {
      timeout: 3000,
      timeoutMsg: 'folding never produced a placeholder',
    })

    await screenshot('p11-3-code-fold-collapsed')

    // Presentation-only, like P6-1's Details collapse state: folding must
    // never touch the saved .md file.
    await browser.pause(500)
    expect(readFileSync(notePath, 'utf-8')).toBe(saved)

    await clickInPage('.code-fold-placeholder')
    await browser.waitUntil(async () => browser.execute(() => !document.querySelector('.code-fold-placeholder')), {
      timeout: 3000,
      timeoutMsg: 'clicking the placeholder never unfolded the region',
    })
  })

  it('Tab inserts a real tab character once the code-indent setting is switched to tab', async () => {
    const notePath = await createNote('P11-3 Tab Setting')

    await browser.keys(['Control', ','])
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.settings-panel')), {
      timeout: 5000,
      timeoutMsg: 'settings panel never opened',
    })
    await browser.execute(() => {
      const select = [...document.querySelectorAll('select')].find((el) =>
        [...el.options].some((o) => o.value === 'tab'),
      )
      if (!(select instanceof HTMLSelectElement)) throw new Error('no code-indent-char select found')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set
      setter?.call(select, 'tab')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await clickInPage('.settings-panel-close')
    // Closing the dialog doesn't return focus to the editor itself, so the
    // '/' below would otherwise land nowhere and the slash menu never opens.
    await focusEditorEnd()
    await browser.keys(['End'])

    await runSlashCommand('Code', 'Code Block')
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.note-editor pre')), {
      timeout: 5000,
      timeoutMsg: 'code block never mounted',
    })
    await browser.keys('x')
    await browser.keys(['Tab'])

    const content = await waitForSavedContent(notePath, 'x\t')
    expect(content).toContain('x\t')
  })
})
