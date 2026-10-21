import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { fillPromptDialog } from '../promptDialog.js'
import { clickNewMenuItem } from '../sidebar.js'
import { screenshot } from '../screenshot.js'

// Simulates a real HTML5 drag-and-drop sequence (dragstart -> dragover ->
// drop) with a live DataTransfer, since our handlers are plain React
// DragEvent listeners rather than a library — a Chromium WebView supports
// DataTransfer for real (unlike jsdom in the unit tests), so this exercises
// the exact browser API path a mouse-driven drag would. The source is found
// by its visible label text, not a bare class selector, since `.tree-note`
// matches every note row in the tree.
async function dragNoteByLabelTo(noteLabel: string, targetSelector: string): Promise<void> {
  await browser.execute(
    (label, dstSel) => {
      const source = Array.from(document.querySelectorAll<HTMLElement>('.tree-note')).find(
        (li) => li.querySelector('.tree-label')?.textContent === label,
      )
      const target = document.querySelector(dstSel)
      if (!source) throw new Error(`drag source note not found: ${label}`)
      if (!(target instanceof HTMLElement)) throw new Error(`drop target not found: ${dstSel}`)
      const dataTransfer = new DataTransfer()
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }))
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer, cancelable: true }))
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer, cancelable: true }))
      // A real drag always ends with dragend on the source, regardless of
      // whether dragleave fired cleanly on everything the pointer crossed —
      // included here so this matches what an actual mouse drag produces.
      source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }))
    },
    noteLabel,
    targetSelector,
  )
}

describe('folders: create, reveal, and drag a note back out', () => {
  const folderPath = join(fixtureWorkspace, 'DragFolder')

  beforeEach(() => {
    rmSync(folderPath, { recursive: true, force: true })
    rmSync(join(fixtureWorkspace, 'Inside Note.md'), { force: true })
  })

  // One flow, not two independent tests: `selectedFolder` (what targets the
  // next created item) is real app state that lives for the whole session,
  // not per-test — splitting "create" and "drag out" into separate `it`s let
  // each one start from the *other* test's leftover selectedFolder/DOM
  // rather than from the state this flow actually produces.
  it('reveals a note created inside a new folder, then moves it back to the workspace root by dragging it', async () => {
    await clickNewMenuItem('Folder') // "Folder" button
    await fillPromptDialog('DragFolder')
    // Folder creation's selectedFolder update (what targets the next note
    // into it) lands after this dialog closes, not before — wait for the
    // folder to actually render before creating the note or the note can
    // race ahead and land at the workspace root instead.
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.tree-folder')), {
      timeout: 5000,
      timeoutMsg: 'the new folder never appeared in the sidebar tree',
    })

    await clickNewMenuItem('Note') // "Note" button — targets selectedFolder
    await fillPromptDialog('Inside Note')
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.ProseMirror')), {
      timeout: 5000,
      timeoutMsg: 'editor never mounted for the new note',
    })

    await screenshot('folder-after-create-note-inside')

    const noteVisibleAfterCreate = await browser.execute(() =>
      Array.from(document.querySelectorAll('.tree-note .tree-label')).some((el) => el.textContent === 'Inside Note'),
    )
    expect(noteVisibleAfterCreate).toBe(true)

    // The root-level folder-tree list itself is the "move back to root" drop
    // target (see FolderTree.tsx) — it fills the sidebar's whole remaining
    // height, not just a small workspace-name label.
    await dragNoteByLabelTo('Inside Note', '.folder-tree')

    await browser.waitUntil(() => !existsSync(join(folderPath, 'Inside Note.md')), {
      timeout: 5000,
      timeoutMsg: 'note file still exists under the folder after dragging it to root',
    })
    expect(existsSync(join(fixtureWorkspace, 'Inside Note.md'))).toBe(true)

    const rootNoteVisible = await browser.waitUntil(
      async () =>
        browser.execute(() =>
          Array.from(document.querySelectorAll('.folder-tree > .tree-note .tree-label')).some(
            (el) => el.textContent === 'Inside Note',
          ),
        ),
      { timeout: 5000, timeoutMsg: 'moved note never reappeared as a root-level row in the sidebar' },
    )
    expect(rootNoteVisible).toBe(true)

    const rootListStillHighlighted = await browser.execute(() =>
      document.querySelector('.folder-tree')?.className.includes('drag-over'),
    )
    expect(rootListStillHighlighted).toBe(false)
  })
})
