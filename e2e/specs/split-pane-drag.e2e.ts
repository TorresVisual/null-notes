import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { fillPromptDialog } from '../promptDialog.js'

async function clickInPage(selector: string): Promise<void> {
  await browser.execute((sel) => {
    const el = document.querySelector(sel)
    if (!(el instanceof HTMLElement)) throw new Error(`clickInPage: no element matching ${sel}`)
    el.click()
  }, selector)
}

async function createNote(title: string): Promise<void> {
  await clickInPage('.sidebar-new-actions button')
  await fillPromptDialog(title)
  await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.ProseMirror')), {
    timeout: 5000,
    timeoutMsg: `editor never mounted for "${title}"`,
  })
}

// Same real-DataTransfer sequence as folder-dnd.e2e.ts's dragNoteByLabelTo,
// but the drop point matters here — it has to land inside the right-edge
// zone Layout.tsx checks via clientX, not just anywhere on the target.
async function dragTabToRightEdge(tabLabel: string): Promise<void> {
  await browser.execute((label) => {
    const source = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).find(
      (el) => el.querySelector('button')?.textContent === label,
    )
    const target = document.querySelector('.editor-body')
    if (!source) throw new Error(`drag source tab not found: ${label}`)
    if (!(target instanceof HTMLElement)) throw new Error('.editor-body not found')
    const rect = target.getBoundingClientRect()
    const dropX = rect.left + rect.width * 0.9
    const dropY = rect.top + rect.height / 2
    const dataTransfer = new DataTransfer()
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }))
    target.dispatchEvent(
      new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, clientX: dropX, clientY: dropY }),
    )
    target.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientX: dropX, clientY: dropY }),
    )
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }))
  }, tabLabel)
}

describe('split-pane editing: drag a tab to the right edge', () => {
  beforeEach(() => {
    // fixtureWorkspace is a fixed, shared path — clear notes a previous failed
    // run may have left behind so note creation here starts from a clean slate.
    rmSync(join(fixtureWorkspace, 'First.md'), { force: true })
    rmSync(join(fixtureWorkspace, 'Second.md'), { force: true })
  })

  it('opens a second note beside the first, and the close button collapses it back', async () => {
    await createNote('First')
    await createNote('Second')

    await dragTabToRightEdge('Second')

    await browser.waitUntil(async () => browser.execute(() => document.querySelectorAll('.pane-wrapper').length === 2), {
      timeout: 5000,
      timeoutMsg: 'dragging the second tab to the right edge never opened a split',
    })

    await clickInPage('[aria-label="Close split pane"]')

    await browser.waitUntil(async () => browser.execute(() => document.querySelectorAll('.pane-wrapper').length === 1), {
      timeout: 5000,
      timeoutMsg: 'closing the secondary pane never collapsed back to one pane',
    })
  })
})
