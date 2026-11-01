import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { screenshot } from '../screenshot.js'

const NOTES = {
  A: '---\n# keep me: a comment inside the frontmatter\nstatus: todo\nlocation: "48.2,16.4"\n---\n# Bases Task A\nBody A\n',
  B: '---\nstatus: doing\nlocation: "47.1,15.4"\n---\n# Bases Task B\n',
  C: '---\nstatus: done\n---\n# Bases Task C\n',
}

const BASE = `views:
  - type: kanban
    name: Board
    groupBy:
      property: status
      direction: ASC
    groupOrder:
      - todo
      - doing
      - done
    order:
      - file.name
  - type: table
    name: Table
    order:
      - file.name
      - status
  - type: list
    name: List
    order:
      - file.name
      - status
  - type: cards
    name: Cards
    order:
      - file.name
      - status
  - type: map
    name: Map
    coordinates: location
    order:
      - file.name
`

const path = (name: string) => join(fixtureWorkspace, name)

const text = (selector: string) =>
  browser.execute((sel) => document.querySelector(sel)?.textContent ?? '', selector)

async function clickInPage(selector: string, contains?: string): Promise<void> {
  await browser.execute(
    (sel, needle) => {
      const match = Array.from(document.querySelectorAll(sel)).find((el) => !needle || el.textContent?.includes(needle))
      if (!(match instanceof HTMLElement)) throw new Error(`${sel} ${needle ?? ''} not found`)
      match.click()
    },
    selector,
    contains,
  )
}

describe('bases', () => {
  it('drags a kanban card and writes the property into the note, keeping its comments', async () => {
    for (const key of ['A', 'B', 'C']) rmSync(path(`Bases Task ${key}.md`), { force: true })
    rmSync(path('Board.base'), { force: true })
    writeFileSync(path('Bases Task A.md'), NOTES.A)
    writeFileSync(path('Bases Task B.md'), NOTES.B)
    writeFileSync(path('Bases Task C.md'), NOTES.C)
    writeFileSync(path('Board.base'), BASE)

    await browser.waitUntil(
      () => browser.execute(() => Array.from(document.querySelectorAll('.tree-label')).some((el) => el.textContent === 'Board')),
      { timeout: 15000, timeoutMsg: 'the base never appeared in the sidebar tree' },
    )
    await clickInPage('.tree-label', 'Board')

    await browser.waitUntil(
      () => browser.execute(() => !!document.querySelector('.base-kanban section[aria-label="todo"] .base-card')),
      { timeout: 15000, timeoutMsg: 'the kanban board never showed Task A under "todo"' },
    )
    await screenshot('bases-kanban')

    await browser.execute(() => {
      const card = Array.from(document.querySelectorAll('.base-kanban .base-card')).find((el) =>
        el.textContent?.includes('Bases Task A'),
      )
      const column = document.querySelector('.base-kanban section[aria-label="doing"]')
      if (!card || !column) throw new Error('card or target column missing')
      card.dispatchEvent(new DragEvent('dragstart', { bubbles: true }))
      column.dispatchEvent(new DragEvent('drop', { bubbles: true }))
    })

    await browser.waitUntil(() => readFileSync(path('Bases Task A.md'), 'utf-8').includes('status: doing'), {
      timeout: 10000,
      timeoutMsg: 'the dropped card never changed the note on disk',
    })
    const after = readFileSync(path('Bases Task A.md'), 'utf-8')
    expect(after).toBe(NOTES.A.replace('status: todo', 'status: doing'))
    expect(readFileSync(path('Bases Task B.md'), 'utf-8')).toBe(NOTES.B)

    await browser.waitUntil(
      () => browser.execute(() => !!document.querySelector('.base-kanban section[aria-label="doing"] .base-card + .base-card')),
      { timeout: 10000, timeoutMsg: 'the card never showed up in the "doing" column' },
    )
    expect(await text('.toast')).toContain('Set status to doing')
    await screenshot('bases-kanban-after-drag')
  })

  it('renders the other four layouts', async () => {
    for (const [tab, check, shot] of [
      ['Table', '.base-table', 'bases-table'],
      ['List', '.base-list', 'bases-list'],
      ['Cards', '.base-cards', 'bases-cards'],
      ['Map', '.base-map', 'bases-map'],
    ] as const) {
      await clickInPage('.base-tab', tab)
      await browser.waitUntil(() => browser.execute((sel) => !!document.querySelector(sel), check), {
        timeout: 10000,
        timeoutMsg: `the ${tab} layout never rendered`,
      })
      await screenshot(shot)
    }
  })
})
