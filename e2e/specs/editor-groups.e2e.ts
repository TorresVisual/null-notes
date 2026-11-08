import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { fillPromptDialog } from '../promptDialog.js'
import { screenshot } from '../screenshot.js'
import { clickNewMenuItem } from '../sidebar.js'

const ONE = join(fixtureWorkspace, 'Group One.md')
const TWO = join(fixtureWorkspace, 'Group Two.md')

async function createNote(title: string, file: string): Promise<void> {
  await clickNewMenuItem('Note')
  await fillPromptDialog(title)
  await browser.waitUntil(() => existsSync(file), { timeout: 5000, timeoutMsg: `${title} was never created` })
  await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.ProseMirror')), {
    timeout: 5000,
    timeoutMsg: `editor never mounted for "${title}"`,
  })
}

const groupCount = () => browser.execute(() => document.querySelectorAll('.editor-group').length)

async function waitForGroups(count: number): Promise<void> {
  await browser.waitUntil(async () => (await groupCount()) === count, {
    timeout: 5000,
    timeoutMsg: `expected ${count} editor group(s), have ${await groupCount()}`,
  })
}

async function focusEditor(group: number): Promise<void> {
  await browser.execute((index) => {
    const pm = document.querySelectorAll('.editor-group')[index]?.querySelector('.ProseMirror')
    if (!(pm instanceof HTMLElement)) throw new Error(`no editor in group ${index}`)
    pm.focus()
    const range = document.createRange()
    range.selectNodeContents(pm)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }, group)
}

const editorText = (group: number) =>
  browser.execute(
    (index) => document.querySelectorAll('.editor-group')[index]?.querySelector('.ProseMirror')?.textContent ?? '',
    group,
  )

const focusedGroupIndex = () =>
  browser.execute(() => Array.from(document.querySelectorAll('.editor-group')).findIndex((el) => el.classList.contains('editor-group--focused')))

async function runCommand(id: string): Promise<void> {
  await browser.execute((command) => {
    ;(window as unknown as { __e2eRunCommand: (id: string) => void }).__e2eRunCommand(command)
  }, id)
}

async function clickTab(group: number, label: string): Promise<void> {
  await browser.execute(
    (index, name) => {
      const tab = Array.from(
        document.querySelectorAll('.editor-group')[index]?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [],
      ).find((el) => el.textContent === name)
      if (!tab) throw new Error(`no tab "${name}" in group ${index}`)
      tab.click()
    },
    group,
    label,
  )
}

// Same real-DataTransfer sequence the old split-pane spec used; the drop point
// has to land in the left quarter of the editor body.
async function dragTabToLeftEdge(label: string): Promise<void> {
  await browser.execute((name) => {
    const source = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'))
      .find((el) => el.textContent === name)
      ?.closest<HTMLElement>('[draggable]')
    const target = document.querySelector('.editor-group')
    const body = document.querySelector('.editor-body')
    if (!source || !(target instanceof HTMLElement) || !(body instanceof HTMLElement)) throw new Error('drag setup failed')
    const rect = body.getBoundingClientRect()
    const at = { clientX: rect.left + rect.width * 0.1, clientY: rect.top + rect.height / 2 }
    const dataTransfer = new DataTransfer()
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }))
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, ...at }))
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, ...at }))
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }))
  }, label)
}

describe('editor groups', () => {
  before(() => {
    rmSync(ONE, { force: true })
    rmSync(TWO, { force: true })
  })

  it('splits from the keyboard, edits one note from both groups, moves focus and closes the group', async () => {
    // The layout of an earlier run is restored with the workspace.
    if ((await groupCount()) === 2) {
      await runCommand('close-editor-group')
      await waitForGroups(1)
    }
    await createNote('Group One', ONE)
    await createNote('Group Two', TWO)
    // Let the file watcher's echo of the two creations land before typing, or it
    // reads as an outside edit of a note that already has unsaved text.
    await browser.pause(1500)
    await focusEditor(0)

    await browser.keys(['Control', '\\'])
    await waitForGroups(2)
    await browser.waitUntil(async () => (await focusedGroupIndex()) === 1, {
      timeout: 3000,
      timeoutMsg: 'the new group never took focus',
    })

    // The same note is open in both groups: typing in one shows in the other,
    // and neither raises the external-change prompt.
    await focusEditor(1)
    await browser.keys('shared words')
    await browser.waitUntil(async () => (await editorText(0)).includes('shared words'), {
      timeout: 5000,
      timeoutMsg: 'the first group never showed what was typed in the second',
    })
    await browser.waitUntil(() => readFileSync(TWO, 'utf8').includes('shared words'), {
      timeout: 5000,
      timeoutMsg: 'the shared edit never reached disk',
    })
    await browser.pause(1500)
    expect(await browser.execute(() => document.querySelectorAll('.conflict-bar').length)).toBe(0)
    await screenshot('editor-groups-shared-note')

    // Each group has its own tabs: show the other note on the left.
    await clickTab(0, 'Group One')
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const tabs = Array.from(document.querySelectorAll('.editor-group')).map(
            (group) => group.querySelector('.tab.active')?.textContent,
          )
          return tabs[0] === 'Group One' && tabs[1] === 'Group Two'
        }),
      { timeout: 5000, timeoutMsg: 'the groups never showed different notes' },
    )
    await screenshot('editor-groups-different-notes')

    expect(await focusedGroupIndex()).toBe(0)
    await browser.keys(['Control', 'Alt', 'ArrowRight'])
    await browser.waitUntil(async () => (await focusedGroupIndex()) === 1, { timeout: 5000, timeoutMsg: 'focus never moved right' })
    await browser.keys(['Control', 'Alt', 'ArrowLeft'])
    await browser.waitUntil(async () => (await focusedGroupIndex()) === 0, { timeout: 5000, timeoutMsg: 'focus never moved left' })

    await runCommand('close-editor-group')
    await waitForGroups(1)
  })

  it('splits when a tab is dropped on the left edge', async () => {
    await dragTabToLeftEdge('Group Two')
    await waitForGroups(2)
    expect(await browser.execute(() => document.querySelectorAll('.editor-group')[0]?.querySelector('.tab.active')?.textContent)).toBe('Group Two')
    await screenshot('editor-groups-edge-drop')
  })

  it('writes the layout to .workspace.json when the workspace closes', async () => {
    await runCommand('close-workspace')
    const file = join(fixtureWorkspace, '.workspace.json')
    await browser.waitUntil(() => existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).layout?.groups?.length === 2, {
      timeout: 5000,
      timeoutMsg: 'the two-group layout never reached .workspace.json',
    })
    const layout = JSON.parse(readFileSync(file, 'utf8')).layout
    expect(layout.direction).toBe('row')
    expect(layout.groups[0].active).toContain('Group Two')
  })
})
