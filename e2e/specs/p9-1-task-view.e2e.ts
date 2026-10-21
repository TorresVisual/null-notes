import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { screenshot } from '../screenshot.js'
import { fillPromptDialog } from '../promptDialog.js'
import { clickNewMenuItem } from '../sidebar.js'

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
async function openTaskView(): Promise<void> {
  await browser.execute(() => {
    const fn = (window as unknown as { __e2eRunCommand?: (id: string) => void }).__e2eRunCommand
    if (!fn) throw new Error('__e2eRunCommand hook missing')
    fn('task-view')
  })
  await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.task-view')), {
    timeout: 5000,
    timeoutMsg: 'task view never rendered',
  })
}

function openTaskItemsFor(noteTitle: string) {
  return browser.execute((title) => {
    const groups = Array.from(document.querySelectorAll('.task-view-group'))
    const group = groups.find((g) => g.querySelector('.task-view-note-title')?.textContent === title)
    if (!group) return null
    return Array.from(group.querySelectorAll('.task-view-item-text')).map((el) => el.textContent)
  }, noteTitle)
}

describe('P9-1: workspace-wide task view', () => {
  it('lists only open tasks grouped by note, and ticking one removes it and flips the file', async () => {
    const notePath = await createNote('P9-1 Tasks A')
    await focusEditorEnd()
    await browser.keys(['Enter'])
    await browser.keys('- [ ] some task')
    await browser.keys(['Enter'])
    await browser.keys('done task')
    await browser.waitUntil(
      async () => browser.execute(() => document.querySelectorAll('.ProseMirror li[data-checked]').length === 2),
      { timeout: 5000, timeoutMsg: 'two task items never rendered' },
    )
    await toggleEditorTaskItem('done task')

    // Debounce-aware: save (600ms) then reindex (2500ms) must both land
    // before note_tasks reflects the typed content.
    await browser.waitUntil(
      () =>
        existsSync(notePath) &&
        readFileSync(notePath, 'utf-8').includes('- [ ] some task') &&
        readFileSync(notePath, 'utf-8').includes('- [x] done task'),
      { timeout: 10000, interval: 300, timeoutMsg: `${notePath} never reached the expected checkbox state` },
    )
    // Reindex debounce is separate from the save debounce above.
    await browser.pause(4000)

    await openTaskView()
    await browser.waitUntil(async () => (await openTaskItemsFor('P9-1 Tasks A')) !== null, {
      timeout: 5000,
      timeoutMsg: 'task view never listed a group for P9-1 Tasks A',
    })
    const items = await openTaskItemsFor('P9-1 Tasks A')
    expect(items).toEqual(['some task'])
    await screenshot('p9-1-task-view-open')

    await browser.execute(() => {
      const groups = Array.from(document.querySelectorAll('.task-view-group'))
      const group = groups.find((g) => g.querySelector('.task-view-note-title')?.textContent === 'P9-1 Tasks A')
      const checkbox = group?.querySelector('input[type="checkbox"]')
      if (!(checkbox instanceof HTMLElement)) throw new Error('checkbox for P9-1 Tasks A not found')
      checkbox.click()
    })
    await browser.waitUntil(async () => (await openTaskItemsFor('P9-1 Tasks A')) === null, {
      timeout: 5000,
      timeoutMsg: 'the P9-1 Tasks A group never disappeared after ticking its only task',
    })

    await browser.waitUntil(
      () => readFileSync(notePath, 'utf-8').includes('- [x] some task'),
      { timeout: 10000, interval: 300, timeoutMsg: `${notePath} was never flipped to [x] on disk` },
    )
    // The task that was already checked in the editor is untouched by this.
    expect(readFileSync(notePath, 'utf-8')).toContain('- [x] done task')
  })

  it('opens the owning note when a task is clicked', async () => {
    const notePath = await createNote('P9-1 Tasks B')
    await focusEditorEnd()
    await browser.keys(['Enter'])
    await browser.keys('- [ ] jump target task')
    await browser.waitUntil(
      () => existsSync(notePath) && readFileSync(notePath, 'utf-8').includes('- [ ] jump target task'),
      { timeout: 10000, interval: 300, timeoutMsg: `${notePath} never contained the typed task` },
    )
    await browser.pause(4000)

    // A second note becomes the active tab, so clicking the task in the view
    // has to actually switch tabs rather than merely closing the overlay.
    await createNote('P9-1 Tasks C')

    await openTaskView()
    try {
      await browser.waitUntil(async () => (await openTaskItemsFor('P9-1 Tasks B')) !== null, {
        timeout: 5000,
        timeoutMsg: 'task view never listed a group for P9-1 Tasks B',
      })
    } catch (e) {
      const dump = await browser.execute(() => document.querySelector('.task-view')?.textContent ?? '<no .task-view>')
      throw new Error(`${(e as Error).message} — task view content: ${dump}`)
    }
    // The list can still churn briefly right as it first appears (a trailing
    // reindex replacing the fetched task set) — give it a beat before the
    // first click attempt, on top of the retry loop below.
    await browser.pause(500)

    try {
      // Idempotent and retried, not a single click: a re-render between the
      // group-list appearing (the waitUntil above) and this click landing —
      // e.g. the reindex debounce still catching up and replacing the task
      // list's DOM nodes — can silently lose a one-shot click. The success
      // condition is both halves of what openNote() does (openTab *and*
      // onClose), checked together — on a mocha retry the tab can already be
      // active from a prior attempt while the view (just reopened fresh by
      // openTaskView() above) is still open, so checking the tab alone would
      // report success without ever having closed this attempt's view.
      await browser.waitUntil(
        async () => {
          const state = await browser.execute(() => ({
            tabActive: document.querySelector('.tab.active button')?.textContent === 'P9-1 Tasks B',
            viewClosed: !document.querySelector('.task-view'),
          }))
          if (state.tabActive && state.viewClosed) return true
          await browser.execute(() => {
            const groups = Array.from(document.querySelectorAll('.task-view-group'))
            const group = groups.find((g) => g.querySelector('.task-view-note-title')?.textContent === 'P9-1 Tasks B')
            const btn = group?.querySelector('.task-view-item-text')
            if (btn instanceof HTMLElement) btn.click()
          })
          return false
        },
        { timeout: 15000, interval: 500, timeoutMsg: 'clicking the task never opened P9-1 Tasks B and closed the view' },
      )
    } catch (e) {
      const dump = await browser.execute(() => ({
        activeTabText: document.querySelector('.tab.active button')?.textContent ?? null,
        allTabs: Array.from(document.querySelectorAll('.tab button')).map((el) => el.textContent),
        taskViewStillOpen: !!document.querySelector('.task-view'),
      }))
      throw new Error(`${(e as Error).message} — ${JSON.stringify(dump)}`)
    }
    expect(await browser.execute(() => !!document.querySelector('.task-view'))).toBe(false)
  })
})
