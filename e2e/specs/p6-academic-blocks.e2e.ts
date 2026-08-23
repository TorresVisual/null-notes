import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { screenshot } from '../screenshot.js'
import { fillPromptDialog } from '../promptDialog.js'

// See create-note.e2e.ts for why these two helpers exist: WebdriverIO's own
// click()/waitForClickable() readiness polling is a slow round trip through
// this driver, and a plain in-page .click() doesn't give ProseMirror a real
// cursor position the way a mouse click does.
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

// Opens the slash menu at the current cursor, types a filter query, and
// clicks the matching item by its exact title text (items carry no
// per-command class, only shared .slash-menu-item / .slash-item-title).
//
// `query` and `title` are separate on purpose: the Suggestion plugin backing
// this menu is configured with allowSpaces: false, so typing a multi-word
// title like "Collapsible Section" closes the popup at the first space
// before a click can land. Pass a single-word substring as `query`.
async function runSlashCommand(query: string, title: string = query): Promise<void> {
  await browser.keys('/')
  await browser.keys(query)
  await browser.waitUntil(
    async () =>
      browser.execute((t) => {
        const items = Array.from(document.querySelectorAll('.slash-menu-item .slash-item-title'))
        return items.some((el) => el.textContent === t)
      }, title),
    { timeout: 5000, timeoutMsg: `slash menu never showed an item titled "${title}"` },
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

  await clickInPage('.sidebar-new-actions button')
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

describe('P6-1: theorem-family callout blocks', () => {
  it('inserts a Theorem block from /, renders its label, and round-trips its body to disk', async () => {
    const notePath = await createNote('P6-1 Theorem')

    await runSlashCommand('Theorem')
    await browser.waitUntil(
      async () => browser.execute(() => !!document.querySelector('.callout-theorem')),
      { timeout: 5000, timeoutMsg: 'Theorem callout never mounted' },
    )

    // Rendered label comes from calloutType, not typed text.
    const labelText = await browser.execute(() =>
      document.querySelector('.callout-theorem .callout-label')?.textContent,
    )
    expect(labelText).toBe('Theorem')

    await browser.keys('Squeeze theorem body text')

    const content = await waitForSavedContent(notePath, 'Squeeze theorem body text')
    expect(content).toContain('[!THEOREM]')
    expect(content).toContain('Squeeze theorem body text')

    await screenshot('p6-1-theorem-callout')
  })

  it('renders a QED mark on Proof blocks and round-trips through save→reload', async () => {
    const notePath = await createNote('P6-1 Proof')

    await runSlashCommand('Proof')
    await browser.waitUntil(
      async () => browser.execute(() => !!document.querySelector('.callout-proof')),
      { timeout: 5000, timeoutMsg: 'Proof callout never mounted' },
    )
    await browser.keys('Trivial by inspection.')

    const content = await waitForSavedContent(notePath, 'Trivial by inspection.')
    expect(content).toContain('[!PROOF]')

    // QED mark is a CSS ::after pseudo-element on the proof body's last
    // child — never stored, so assert it via getComputedStyle rather than
    // textContent.
    const qed = await browser.execute(() => {
      const lastChild = document.querySelector('.callout-proof .callout-body > *:last-child')
      if (!lastChild) return null
      return window.getComputedStyle(lastChild, '::after').content
    })
    expect(qed).toContain('∎')

    await screenshot('p6-1-proof-qed')
  })
})

describe('P6-1: collapsible sections are presentation-only', () => {
  it('toggles open/closed in the DOM without writing the state to disk', async () => {
    const notePath = await createNote('P6-1 Collapsible')

    await runSlashCommand('Collapsible', 'Collapsible Section')
    await browser.waitUntil(
      async () => browser.execute(() => !!document.querySelector('.details-wrapper')),
      { timeout: 5000, timeoutMsg: 'Details node never mounted' },
    )

    // Fill the summary via its input, then move into the body and type.
    await browser.execute(() => {
      const input = document.querySelector<HTMLInputElement>('.details-summary-input')
      if (!input) throw new Error('no .details-summary-input')
      input.focus()
    })
    await browser.keys('Proof sketch')
    await browser.execute(() => {
      const input = document.querySelector<HTMLInputElement>('.details-summary-input')
      input?.blur()
    })

    await browser.execute(() => {
      const body = document.querySelector('.details-body')
      const p = body?.querySelector('p')
      if (!(p instanceof HTMLElement)) throw new Error('no paragraph inside .details-body')
      const range = document.createRange()
      range.selectNodeContents(p)
      range.collapse(false)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
      p.focus()
    })
    await browser.keys('Body content that should stay in the DOM')

    const content = await waitForSavedContent(notePath, 'Body content that should stay in the DOM')
    expect(content).toContain('<summary>Proof sketch</summary>')
    expect(content).not.toContain('<details open>')

    // Sections default open.
    const openBefore = await browser.execute(() =>
      document.querySelector('.details-wrapper')?.classList.contains('open'),
    )
    expect(openBefore).toBe(true)
    await screenshot('p6-1-collapsible-open')

    const savedBeforeToggle = readFileSync(notePath, 'utf-8')

    // Collapse it.
    await clickInPage('.details-summary')
    await browser.waitUntil(
      async () =>
        browser.execute(() => !document.querySelector('.details-wrapper')?.classList.contains('open')),
      { timeout: 5000, timeoutMsg: 'details-wrapper never lost its open class' },
    )
    await screenshot('p6-1-collapsible-closed')

    // Content stays mounted (hidden via CSS), not removed from the DOM —
    // required so print/PDF export can still see it.
    const bodyStillPresent = await browser.execute(() =>
      document.querySelector('.details-body')?.textContent?.includes('Body content that should stay in the DOM'),
    )
    expect(bodyStillPresent).toBe(true)
    const bodyHidden = await browser.execute(
      () => window.getComputedStyle(document.querySelector('.details-body')!).display,
    )
    expect(bodyHidden).toBe('none')

    // Collapsing must not touch the .md file — no debounced save, no dirty
    // buffer, no auto-commit trigger.
    await browser.pause(1000)
    expect(readFileSync(notePath, 'utf-8')).toBe(savedBeforeToggle)

    // Re-expand and confirm the file is still untouched.
    await clickInPage('.details-summary')
    await browser.waitUntil(
      async () => browser.execute(() => document.querySelector('.details-wrapper')?.classList.contains('open')),
      { timeout: 5000, timeoutMsg: 'details-wrapper never regained its open class' },
    )
    await browser.pause(1000)
    expect(readFileSync(notePath, 'utf-8')).toBe(savedBeforeToggle)
  })
})

describe('P6-2: algorithm blocks', () => {
  it('inserts prefilled Complexity/Pseudocode/Implementation/References slots and round-trips edits', async () => {
    const notePath = await createNote('P6-2 Algorithm')

    await runSlashCommand('Algorithm', 'Algorithm Block')
    await browser.waitUntil(
      async () => browser.execute(() => !!document.querySelector('.callout-algorithm')),
      { timeout: 5000, timeoutMsg: 'Algorithm callout never mounted' },
    )

    const labelText = await browser.execute(
      () => document.querySelector('.callout-algorithm .callout-label')?.textContent,
    )
    expect(labelText).toBe('Algorithm')

    const bodyText = await browser.execute(() => document.querySelector('.callout-algorithm .callout-body')?.textContent)
    expect(bodyText).toContain('Complexity:')
    expect(bodyText).toContain('Pseudocode:')
    expect(bodyText).toContain('Implementation:')
    expect(bodyText).toContain('References:')

    // Click into the Pseudocode code block (first <pre><code> in the callout)
    // and type real content into it.
    await browser.execute(() => {
      const code = document.querySelector('.callout-algorithm pre code')
      if (!(code instanceof HTMLElement)) throw new Error('no code block inside algorithm callout')
      code.focus()
      const range = document.createRange()
      range.selectNodeContents(code)
      range.collapse(false)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    })
    await browser.keys('for each vertex, relax edges')

    const content = await waitForSavedContent(notePath, 'for each vertex, relax edges')
    expect(content).toContain('[!ALGORITHM]')
    expect(content).toContain('**Complexity:**')
    expect(content).toContain('**Pseudocode:**')
    expect(content).toContain('**Implementation:**')
    expect(content).toContain('**References:**')
    expect(content).toContain('for each vertex, relax edges')

    await screenshot('p6-2-algorithm-block')
  })
})
