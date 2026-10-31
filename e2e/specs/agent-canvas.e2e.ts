import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { screenshot } from '../screenshot.js'

interface PassFixture {
  pass: number
  topic: string
  y: number
}

function passElements({ pass, topic, y }: PassFixture) {
  return [
    { id: `g${pass}`, type: 'group', x: 0, y, width: 520, height: 260, label: `Pass ${pass} · ${topic}`, pass, author: 'agent' },
    { id: `q${pass}`, type: 'text', x: 20, y: y + 50, width: 220, height: 70, text: `Question ${pass}`, pass, author: 'agent' },
    { id: `a${pass}`, type: 'text', x: 280, y: y + 50, width: 220, height: 70, text: `Answer ${pass}`, pass, author: 'agent' },
  ]
}

// The agent protocol: write a temp file next to the canvas, then rename over it.
function writeAtomically(path: string, passes: PassFixture[]) {
  const nodes = passes.flatMap(passElements)
  const edges = passes.map(({ pass }) => ({ id: `e${pass}`, fromNode: `q${pass}`, toNode: `a${pass}`, pass, author: 'agent' }))
  const temp = join(fixtureWorkspace, '.agent-brainstorm.canvas.tmp')
  writeFileSync(temp, JSON.stringify({ nodes, edges, lastPass: passes.length }, null, 2))
  renameSync(temp, path)
}

const exists = (selector: string) =>
  browser.execute((sel) => !!document.querySelector(sel), selector)

const groupLabels = () =>
  browser.execute(() => Array.from(document.querySelectorAll('.canvas-group-label')).map((el) => el.textContent ?? ''))

describe('agent canvas', () => {
  it('shows an agent pass, live-merges the next one, and keeps both when the user adds a card', async () => {
    const canvasPath = join(fixtureWorkspace, 'agent-brainstorm.canvas')
    rmSync(canvasPath, { force: true })
    const pass1 = { pass: 1, topic: 'retries', y: 0 }
    const pass2 = { pass: 2, topic: 'idempotency', y: 320 }
    writeAtomically(canvasPath, [pass1])

    await browser.waitUntil(
      () =>
        browser.execute(() =>
          Array.from(document.querySelectorAll('.tree-label')).some((el) => el.textContent === 'agent-brainstorm'),
        ),
      { timeout: 10000, timeoutMsg: 'the canvas never appeared in the sidebar tree' },
    )
    await browser.execute(() => {
      const label = Array.from(document.querySelectorAll('.tree-label')).find((el) => el.textContent === 'agent-brainstorm')
      if (!(label instanceof HTMLElement)) throw new Error('canvas tree row not found')
      label.click()
    })

    await browser.waitUntil(async () => (await groupLabels()).some((l) => l.includes('Pass 1')), {
      timeout: 10000,
      timeoutMsg: 'Pass 1 never rendered',
    })

    writeAtomically(canvasPath, [pass1, pass2])

    await browser.waitUntil(async () => (await groupLabels()).some((l) => l.includes('Pass 2')), {
      timeout: 10000,
      timeoutMsg: 'Pass 2 never appeared after the external write',
    })
    await browser.waitUntil(
      () =>
        browser.execute(() =>
          Array.from(document.querySelectorAll('.toast')).some((el) => el.textContent?.includes('Pass 2 added')),
        ),
      { timeout: 5000, timeoutMsg: 'no "Pass 2 added" toast' },
    )
    expect(await exists('.conflict-bar')).toBe(false)
    await screenshot('agent-canvas-pass-2-arrived')

    await browser.execute(() => {
      const button = document.querySelector('button[aria-label="Add text card"]')
      if (!(button instanceof HTMLElement)) throw new Error('Add text card button not found')
      button.click()
    })

    await browser.waitUntil(
      () => {
        const saved = JSON.parse(readFileSync(canvasPath, 'utf-8')) as { nodes: Array<{ id: string; pass?: number }> }
        return saved.nodes.length === 7
      },
      { timeout: 10000, interval: 300, timeoutMsg: 'the hand-added card never reached disk' },
    )

    const saved = JSON.parse(readFileSync(canvasPath, 'utf-8')) as {
      nodes: Array<{ id: string; pass?: number; author?: string }>
      lastPass: number
    }
    expect(saved.nodes.filter((n) => n.pass === 1)).toHaveLength(3)
    expect(saved.nodes.filter((n) => n.pass === 2)).toHaveLength(3)
    expect(saved.nodes.filter((n) => n.author === undefined)).toHaveLength(1)
    expect(saved.lastPass).toBe(2)
  })
})
