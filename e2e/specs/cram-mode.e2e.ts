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

  await clickInPage('.sidebar-new-actions button')
  await fillPromptDialog(title)
  await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.ProseMirror')), {
    timeout: 5000,
    timeoutMsg: 'editor never mounted for the new note',
  })
  return notePath
}

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

async function closeReview(): Promise<void> {
  await browser.execute(() => {
    const closeBtn = document.querySelector('.review-session .settings-panel-close')
    if (closeBtn instanceof HTMLElement) closeBtn.click()
  })
  await browser.waitUntil(async () => browser.execute(() => !document.querySelector('.review-session')), {
    timeout: 5000,
    timeoutMsg: 'review session never closed',
  })
}

async function openDeckView(): Promise<void> {
  await runCommand('deck-view')
  await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.deck-view')), {
    timeout: 5000,
    timeoutMsg: 'deck view never rendered',
  })
}

function reviewFrontText() {
  return browser.execute(() => document.querySelector('.review-card-front')?.textContent ?? null)
}

function scheduleComment(notePath: string): string {
  const content = readFileSync(notePath, 'utf-8')
  const match = content.match(/<!-- sr due=[^\n]*-->/)
  if (!match) throw new Error(`${notePath}: no schedule comment found on disk yet`)
  return match[0]
}

async function clickCramButton(categoryLabel: string): Promise<void> {
  await browser.execute((label) => {
    const chips = Array.from(document.querySelectorAll('.deck-view-category'))
    const chip = chips.find((el) => el.textContent?.includes(label))
    if (!chip) throw new Error(`no category chip containing "${label}"`)
    const btn = chip.querySelector('.deck-view-category-cram')
    if (!(btn instanceof HTMLElement)) throw new Error(`no Cram button inside chip "${label}"`)
    btn.click()
  }, categoryLabel)
}

// A mocha retry re-runs the `it()` body from the top, but React state (the
// active overlay in Layout.tsx) survives across it — force every overlay
// this spec opens closed after each attempt, same precedent as
// flashcards.e2e.ts. A failed attempt's note (created but never fully
// graded) also has to go: left behind, it's still due today, so the retry's
// review queue would return two cards instead of one and `queue[0]` could
// land on the stale leftover instead of the retry's own fresh note. Deleting
// through the app's own `delete_note` command (not a raw fs.rmSync) matters
// here — a raw file delete leaves the DB's review_cards row behind (nothing
// re-reads that path to trigger the backend's own forget_note cleanup), so a
// bare rmSync would just replace one ghost with another on every retry.
let activeNotePath: string | null = null

afterEach(async () => {
  await browser.execute(() => {
    document.querySelectorAll('.review-session .settings-panel-close, .deck-view .settings-panel-close').forEach((btn) => {
      if (btn instanceof HTMLElement) btn.click()
    })
  })
  if (activeNotePath) {
    await browser.execute(async (path) => {
      const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (cmd: string, args: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__
      if (!internals) return
      await internals.invoke('delete_note', { path }).catch(() => {})
    }, activeNotePath)
    rmSync(activeNotePath, { force: true })
    activeNotePath = null
  }
})

describe('cram mode', () => {
  it('drills a streak category ignoring due date, and the card drops out once regraded', async () => {
    const title = `Cram Card ${Date.now()}`
    const notePath = await createNote(title)
    activeNotePath = notePath

    await focusEditorEnd()
    await browser.keys(['End', 'Enter'])
    await browser.keys('Question :: Answer')

    await browser.waitUntil(
      () => existsSync(notePath) && readFileSync(notePath, 'utf-8').includes('Question :: Answer'),
      { timeout: 10000, interval: 300, timeoutMsg: `${notePath} never contained the QA card` },
    )
    // Reindex debounce (2500ms) so the card lands in review_cards before
    // Review's fetch queries see it.
    await browser.pause(2500)

    // Grade Good once via the normal due-queue review — streak reaches 1,
    // and SM2 pushes `due` to tomorrow, so the card immediately falls out of
    // today's due queue. That's expected scheduling behavior, not a bug: it's
    // exactly why the second Good grading below has to go through cram mode
    // instead of a second normal review.
    await openReview()
    await browser.waitUntil(async () => (await reviewFrontText()) === 'Question', {
      timeout: 5000,
      timeoutMsg: 'review session never showed the QA card front',
    })
    await clickButtonByText('.review-card-reveal', 'Reveal answer')
    await clickButtonByText('.review-card-grade', 'Good')
    await browser.waitUntil(() => scheduleComment(notePath).includes('streak=1'), {
      timeout: 10000,
      timeoutMsg: `${notePath} never got a streak=1 schedule comment`,
    })
    await closeReview()

    // Cram Category 1 to grade Good a second time — the card is due
    // tomorrow, so only cram mode (not a normal review) can reach it.
    await openDeckView()
    await browser.waitUntil(
      async () =>
        browser.execute(() =>
          Array.from(document.querySelectorAll('.deck-view-category')).some((el) => el.textContent?.includes('Category 1')),
        ),
      { timeout: 5000, timeoutMsg: 'deck view never showed a Category 1 chip' },
    )
    await clickCramButton('Category 1')
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.review-session')), {
      timeout: 5000,
      timeoutMsg: 'cram session never opened from the deck view for Category 1',
    })
    await browser.waitUntil(async () => (await reviewFrontText()) === 'Question', {
      timeout: 5000,
      timeoutMsg: 'cram session never showed the Category 1 card',
    })
    await clickButtonByText('.review-card-reveal', 'Reveal answer')
    await clickButtonByText('.review-card-grade', 'Good')
    await browser.waitUntil(() => scheduleComment(notePath).includes('streak=2'), {
      timeout: 10000,
      timeoutMsg: `${notePath} never got a streak=2 schedule comment`,
    })
    await closeReview()

    // Browse All Cards shows it under Category 2 even though `due` is days out.
    await openDeckView()
    await browser.waitUntil(
      async () =>
        browser.execute(() =>
          Array.from(document.querySelectorAll('.deck-view-category')).some((el) => el.textContent?.includes('Category 2')),
        ),
      { timeout: 5000, timeoutMsg: 'deck view never showed a Category 2 chip' },
    )
    await screenshot('cram-mode-category-chip')

    // Cram Category 2 — the card is due days from now, so only cram mode
    // (not a normal review) can reach it.
    await clickCramButton('Category 2')
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.review-session')), {
      timeout: 5000,
      timeoutMsg: 'cram session never opened from the deck view',
    })
    await browser.waitUntil(async () => (await reviewFrontText()) === 'Question', {
      timeout: 5000,
      timeoutMsg: 'cram session never showed the Category 2 card',
    })
    await screenshot('cram-mode-session')

    // Grade it Again — streak resets to 0, dropping it out of Category 2.
    await clickButtonByText('.review-card-reveal', 'Reveal answer')
    await clickButtonByText('.review-card-grade', 'Again')
    await browser.waitUntil(() => scheduleComment(notePath).includes('streak=0'), {
      timeout: 10000,
      timeoutMsg: `${notePath} never reset to a streak=0 schedule comment`,
    })
    await closeReview()

    // DeckView fetches once on mount and never re-polls — the file write
    // (already confirmed above) lands slightly before grade_card_at's own
    // DB update (index_note_at) within the same backend call, so opening
    // DeckView immediately after the file check can still catch the DB one
    // beat stale with no self-correction. A short buffer here, not a longer
    // waitUntil on the chip itself, since a stale-data render never changes
    // without a fresh mount.
    await browser.pause(500)
    await openDeckView()
    await browser.waitUntil(
      async () =>
        browser.execute(() =>
          Array.from(document.querySelectorAll('.deck-view-category')).some((el) => el.textContent?.includes('New (1)')),
        ),
      { timeout: 10000, timeoutMsg: 'deck view never showed the card back under New after it reset' },
    )
    expect(
      await browser.execute(() =>
        !Array.from(document.querySelectorAll('.deck-view-category')).some((el) => el.textContent?.includes('Category 2')),
      ),
    ).toBe(true)
  })
})
