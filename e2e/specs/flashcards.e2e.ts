import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

// A checked item in the editor's own TaskItem checkbox, not typed — the
// stock TipTap input rule only recognises "[ ] " (see index.ts's
// TaskItemInLists comment), so this is how a real user produces "- [x] …".
async function toggleEditorTaskItem(text: string): Promise<void> {
  await browser.execute((t) => {
    const items = Array.from(document.querySelectorAll('.ProseMirror li[data-checked]'))
    const li = items.find((el) => el.textContent?.includes(t))
    if (!li) throw new Error(`no task item containing "${t}"`)
    const checkbox = li.querySelector('input[type="checkbox"]')
    if (!(checkbox instanceof HTMLElement)) throw new Error(`no checkbox inside task item "${t}"`)
    checkbox.click()
  }, text)
}

// WebDriver automates the WebView, not the native menu bar — see Layout.tsx's
// __e2eRunCommand for why this is how "menu-only" actions get reached here.
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

function reviewFrontText() {
  return browser.execute(() => document.querySelector('.review-card-front')?.textContent ?? null)
}

async function pickMcOption(optionText: string): Promise<void> {
  await clickInPage(`.review-card-options input[aria-label="${optionText}"]`)
}

async function submitMc(): Promise<void> {
  await clickButtonByText('.review-card-reveal', 'Submit')
  await browser.waitUntil(
    async () => browser.execute(() => document.querySelector('.review-card-reveal')?.textContent === 'Next'),
    { timeout: 5000, timeoutMsg: 'MC submit never resolved to a Next button' },
  )
}

function scheduleComment(notePath: string): string {
  const content = readFileSync(notePath, 'utf-8')
  const match = content.match(/<!-- sr due=[^\n]*-->/)
  if (!match) throw new Error(`${notePath}: no schedule comment found on disk yet`)
  return match[0]
}

// "Advances the mocked date" without touching the OS clock. list_due_cards
// compares review_cards.due (kept in sync with the note's own schedule
// comment via the workspace watcher's reindex) against real wall-clock
// "today" server-side (sm2::today(), unreachable from the frontend) — so
// rewriting the comment's due= field into the past makes the card due again
// exactly as if a day had passed, with no system-clock manipulation at all.
function makeCardDueNow(notePath: string): void {
  const content = readFileSync(notePath, 'utf-8')
  const rewritten = content.replace(/due=\d{4}-\d{2}-\d{2}/, 'due=2000-01-01')
  if (rewritten === content) throw new Error(`${notePath}: no due= field found to rewrite`)
  writeFileSync(notePath, rewritten)
}

// A mocha retry re-runs the `it()` body from the top, but React state (like
// `reviewOpen`/the active overlay in Layout.tsx) survives across it — force
// every overlay this spec opens closed after each attempt so a failed retry
// can't carry a stale, already-mounted modal into the next one (same
// precedent as P9-3's spaced-repetition spec).
afterEach(async () => {
  await browser.execute(() => {
    document.querySelectorAll('.review-session .settings-panel-close, .deck-view .settings-panel-close').forEach((btn) => {
      if (btn instanceof HTMLElement) btn.click()
    })
  })
})

describe('flashcards: MC review and the deck view', () => {
  it('grades an MC card through the auto-grade ladder and lists it in the deck view', async () => {
    // A unique title per attempt so a mocha retry gets a genuinely fresh
    // note rather than reusing an already-graded file from a failed attempt.
    const title = `MC Flashcard ${Date.now()}`
    const notePath = await createNote(title)

    await focusEditorEnd()
    // A fresh note opens with the cursor in the title heading; the JS
    // Selection/Range collapse in focusEditorEnd doesn't always win the race
    // against WebView2's own native focus catching up (see create-note.e2e.ts's
    // identical 'End' mitigation) — plain 'Enter' alone intermittently drops
    // every keystroke that follows.
    await browser.keys(['End', 'Enter'])
    await browser.keys('Question ::')
    await browser.keys(['Enter'])
    await browser.keys('- [ ] wrong')
    await browser.keys(['Enter'])
    await browser.keys('right')
    try {
      await browser.waitUntil(
        async () => browser.execute(() => document.querySelectorAll('.ProseMirror li[data-checked]').length === 2),
        { timeout: 5000, timeoutMsg: 'two MC option task items never rendered' },
      )
    } catch (e) {
      const html = await browser.execute(() => document.querySelector('.ProseMirror')?.innerHTML ?? '<no .ProseMirror>')
      throw new Error(`${(e as Error).message} — editor HTML: ${html}`)
    }
    await toggleEditorTaskItem('right')

    await browser.waitUntil(
      () =>
        existsSync(notePath) &&
        readFileSync(notePath, 'utf-8').includes('Question ::') &&
        readFileSync(notePath, 'utf-8').includes('- [ ] wrong') &&
        readFileSync(notePath, 'utf-8').includes('- [x] right'),
      { timeout: 10000, interval: 300, timeoutMsg: `${notePath} never contained the MC card` },
    )
    // Reindex debounce (2500ms) so the card lands in review_cards before
    // Review's listDueCards query sees it.
    await browser.pause(2500)

    // Round 1: pick the wrong option on a brand-new card. mc_auto_grade
    // starts an ungraded card at the Hard baseline, so a wrong first pick
    // drops one rung to Again.
    await openReview()
    await browser.waitUntil(async () => (await reviewFrontText()) === 'Question', {
      timeout: 5000,
      timeoutMsg: 'review session never showed the MC card front',
    })
    await screenshot('flashcards-mc-review-options')
    await pickMcOption('wrong')
    await submitMc()
    await browser.waitUntil(() => scheduleComment(notePath).includes('grade=again'), {
      timeout: 5000,
      timeoutMsg: `${notePath} never got a grade=again schedule comment`,
    })
    await screenshot('flashcards-mc-review-graded-again')
    await closeReview()

    // Round 2: advance the mocked due date and pick the right option. The
    // ladder moves exactly one rung per attempt (sm2::mc_auto_grade), so a
    // correct pick from Again lands on Hard, not yet Good.
    makeCardDueNow(notePath)
    await browser.pause(2500)
    await openReview()
    await browser.waitUntil(async () => (await reviewFrontText()) === 'Question', {
      timeout: 5000,
      timeoutMsg: 'review session never showed the MC card again after advancing its due date',
    })
    await pickMcOption('right')
    await submitMc()
    await browser.waitUntil(() => scheduleComment(notePath).includes('grade=hard'), {
      timeout: 5000,
      timeoutMsg: `${notePath} never advanced to a grade=hard schedule comment`,
    })
    await closeReview()

    // Round 3: advance again and pick right again — the ladder reaches Good.
    makeCardDueNow(notePath)
    await browser.pause(2500)
    await openReview()
    await browser.waitUntil(async () => (await reviewFrontText()) === 'Question', {
      timeout: 5000,
      timeoutMsg: 'review session never showed the MC card again for the third round',
    })
    await pickMcOption('right')
    await submitMc()
    await browser.waitUntil(() => scheduleComment(notePath).includes('grade=good'), {
      timeout: 5000,
      timeoutMsg: `${notePath} never advanced to a grade=good schedule comment`,
    })
    await screenshot('flashcards-mc-review-graded-good')
    await closeReview()

    // Deck view lists the card under its note's title.
    await runCommand('deck-view')
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.deck-view')), {
      timeout: 5000,
      timeoutMsg: 'deck view never rendered',
    })
    await browser.waitUntil(
      async () =>
        browser.execute((t) => {
          const groups = Array.from(document.querySelectorAll('.task-view-group'))
          const group = groups.find((g) => g.querySelector('.task-view-note-title')?.textContent === t)
          return !!group && Array.from(group.querySelectorAll('.task-view-item-text')).some((el) => el.textContent === 'Question')
        }, title),
      { timeout: 5000, timeoutMsg: 'deck view never listed the MC card under its note title' },
    )
    await screenshot('flashcards-deck-view')

    expect(
      await browser.execute((t) => {
        const groups = Array.from(document.querySelectorAll('.task-view-group'))
        return groups.some((g) => g.querySelector('.task-view-note-title')?.textContent === t)
      }, title),
    ).toBe(true)
  })
})
