import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { screenshot } from '../screenshot.js'
import { fillPromptDialog } from '../promptDialog.js'

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
  await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.ProseMirror')), {
    timeout: 5000,
    timeoutMsg: 'editor never mounted for the new note',
  })
  return notePath
}

// WebDriver automates the WebView, not the native menu bar — `review` (like
// `task-view`) is a menu-only action per the P6-6 postmortem's precedent.
async function runCommand(id: string): Promise<void> {
  await browser.execute((cmd) => {
    const fn = (window as unknown as { __e2eRunCommand?: (id: string) => void }).__e2eRunCommand
    if (!fn) throw new Error('__e2eRunCommand hook missing')
    fn(cmd)
  }, id)
}

async function openReview(): Promise<void> {
  await runCommand('review')
  await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.review-session')), {
    timeout: 5000,
    timeoutMsg: 'review session never rendered',
  })
}

function reviewFrontText() {
  return browser.execute(() => document.querySelector('.review-card-front')?.textContent ?? null)
}

async function gradeCurrentCard(label: string): Promise<void> {
  await clickButtonByText('.review-card-reveal', 'Reveal answer')
  await clickButtonByText('.review-card-grade', label)
}

// A mocha retry re-runs the `it()` body from the top, but React state
// (like `reviewOpen` in Layout.tsx) survives across it — a failed first
// attempt that leaves the review session open would otherwise carry a
// stale, already-mounted modal into the retry, which never re-fetches for
// the retry's freshly created note. Force it closed after every attempt.
afterEach(async () => {
  await browser.execute(() => {
    const closeBtn = document.querySelector('.review-session .settings-panel-close')
    if (closeBtn instanceof HTMLElement) closeBtn.click()
  })
})

describe('P9-3: spaced repetition', () => {
  it('reviews a Q::A and a cloze card, writing schedule state back to disk', async () => {
    // A unique title per attempt (not a fixed "P9-3 Review") — generated
    // fresh inside the test body so a mocha retry gets a genuinely new
    // title too, not just a new file at the same path. A retry reusing the
    // same path can hit an already-open tab from the failed attempt whose
    // in-memory buffer was never cleared by `rmSync` (a disk-level delete),
    // so a retry's typing lands appended after the first attempt's text
    // instead of into a clean note.
    const notePath = await createNote(`P9-3 Review ${Date.now()}`)
    await focusEditorEnd()
    await browser.keys(['Enter'])
    await browser.keys('What is Big-O of binary search? :: O(log n)')
    await browser.keys(['Enter'])
    await browser.keys('A binary search tree keeps {{all left descendants smaller}} than the node.')

    await browser.waitUntil(
      () =>
        existsSync(notePath) &&
        readFileSync(notePath, 'utf-8').includes('What is Big-O of binary search? :: O(log n)') &&
        readFileSync(notePath, 'utf-8').includes('{{all left descendants smaller}}'),
      { timeout: 10000, interval: 300, timeoutMsg: `${notePath} never contained both cards` },
    )
    // Reindex debounce (2500ms, REINDEX_DEBOUNCE_MS) so both cards land in
    // review_cards before the review session queries for them.
    await browser.pause(4000)

    await openReview()
    await browser.waitUntil(async () => (await reviewFrontText())?.includes('Big-O') ?? false, {
      timeout: 5000,
      timeoutMsg: 'review session never showed the Q::A card first',
    })
    await screenshot('p9-3-review-front')

    await gradeCurrentCard('Good')
    // The cloze card's front deliberately hides the {{...}} span behind
    // "[...]" — "descendants" only appears once revealed.
    await browser.waitUntil(async () => (await reviewFrontText())?.includes('[...]') ?? false, {
      timeout: 5000,
      timeoutMsg: 'review session never advanced to the cloze card',
    })
    await screenshot('p9-3-review-revealed')

    await gradeCurrentCard('Good')
    await browser.waitUntil(
      async () =>
        browser.execute(() => document.querySelector('.empty-state')?.textContent?.includes('All done') ?? false),
      { timeout: 5000, timeoutMsg: 'review session never showed "All done for today"' },
    )

    await browser.waitUntil(
      () => (readFileSync(notePath, 'utf-8').match(/<!-- sr due=/g) ?? []).length === 2,
      { timeout: 10000, interval: 300, timeoutMsg: `${notePath} never got two schedule comments written back` },
    )
    const content = readFileSync(notePath, 'utf-8')
    expect(content).toMatch(
      /What is Big-O of binary search\? :: O\(log n\)\n<!-- sr due=\d{4}-\d{2}-\d{2} ease=2\.50 interval=1 reps=1(?: grade=\S+)? -->/,
    )
  })

  it("drops a graded card from Home's Study count", async () => {
    // Continues from the previous test: both cards were just graded Good
    // with a 1-day interval, so neither is due again today.
    await runCommand('home')
    await browser.waitUntil(
      async () => browser.execute(() => document.querySelector('.home-section h2')?.textContent === 'Continue'),
      { timeout: 5000, timeoutMsg: 'home view never rendered' },
    )
    const studyText = await browser.execute(() => {
      const sections = Array.from(document.querySelectorAll('.home-section'))
      const study = sections.find((s) => s.querySelector('h2')?.textContent === 'Study')
      return study?.textContent ?? null
    })
    expect(studyText).toContain('Nothing due.')
  })
})
