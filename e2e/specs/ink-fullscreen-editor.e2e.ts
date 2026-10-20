import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
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

async function waitForSelector(selector: string, timeoutMsg: string): Promise<void> {
  await browser.waitUntil(
    async () => browser.execute((sel) => !!document.querySelector(sel), selector),
    { timeout: 10000, timeoutMsg },
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
  await focusEditorEnd()
  await browser.keys(['End', 'Enter'])
  return notePath
}

// Real pen input through WebDriver, not synthetic DOM events: the canvas reads
// getCoalescedEvents() and pressure, which a dispatched PointerEvent does not
// provide. A zigzag, not a line: a near-straight stroke is converted to a line
// shape by the auto-straighten.
async function drawZigzag(): Promise<void> {
  const origin = await browser.execute(() => {
    const canvas = document.querySelector('.ink-editor-overlay canvas')
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('no overlay canvas')
    const rect = canvas.getBoundingClientRect()
    return { left: Math.round(rect.left), top: Math.round(rect.top) }
  })
  const pen = browser.action('pointer', { parameters: { pointerType: 'pen' } })
  pen.move({ x: origin.left + 40, y: origin.top + 40, origin: 'viewport' }).down({ button: 0 })
  for (let i = 1; i <= 20; i++) {
    pen.move({ x: origin.left + 40 + i * 15, y: origin.top + 40 + (i % 2 ? 60 : 0), origin: 'viewport' })
  }
  pen.up({ button: 0 })
  await pen.perform()
}

describe('full-screen ink editor', () => {
  it('opens on insert, saves what is drawn, and previews it after Done', async () => {
    const notePath = await createNote('Ink Fullscreen')

    await browser.keys('/')
    await browser.keys('Ink')
    await waitForSelector('.slash-menu-item', 'slash menu never opened')
    await browser.execute(() => {
      const item = Array.from(document.querySelectorAll('.slash-menu-item')).find(
        (el) => el.querySelector('.slash-item-title')?.textContent === 'Ink Block',
      )
      if (!(item instanceof HTMLElement)) throw new Error('no Ink Block slash item')
      item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    })

    await waitForSelector('.ink-editor-overlay', 'overlay never opened after insert')
    await waitForSelector('.ink-editor-header .draw-ribbon', 'draw ribbon missing in the overlay header')
    await screenshot('ink-fullscreen-open')

    await clickInPage('.ink-pen-card.active')
    await waitForSelector('.ink-flyout', 'pen flyout never opened')
    await screenshot('ink-draw-ribbon-flyout')
    await browser.keys('Escape')
    await browser.waitUntil(
      async () => browser.execute(() => !document.querySelector('.ink-flyout')),
      { timeout: 5000, timeoutMsg: 'Escape did not close the flyout' },
    )
    expect(await browser.execute(() => !!document.querySelector('.ink-editor-overlay'))).toBe(true)

    await drawZigzag()
    await clickInPage('.ink-editor-done')
    await browser.waitUntil(
      async () => browser.execute(() => !document.querySelector('.ink-editor-overlay')),
      { timeout: 5000, timeoutMsg: 'overlay never closed' },
    )

    await waitForSelector('.ink-preview-page svg path', 'preview never showed the stroke')
    expect(await browser.execute(() => !!document.querySelector('.ink-canvas-wrap'))).toBe(false)
    await screenshot('ink-fullscreen-preview')

    await browser.waitUntil(() => existsSync(notePath) && readFileSync(notePath, 'utf-8').includes('```ink'), {
      timeout: 10000,
      interval: 300,
      timeoutMsg: 'note never saved the ink block',
    })
    expect(readFileSync(notePath, 'utf-8')).not.toContain('"inline"')
  })

  it('re-opens from the preview', async () => {
    await waitForSelector('.ink-preview', 'preview missing — depends on the previous test')
    await clickInPage('.ink-preview')
    await waitForSelector('.ink-editor-overlay', 'click on the preview did not open the editor')
    await browser.keys('Escape')
    await browser.waitUntil(
      async () => browser.execute(() => !document.querySelector('.ink-editor-overlay')),
      { timeout: 5000, timeoutMsg: 'Escape did not close the overlay' },
    )
  })

  it('keeps a canvas note inline', async () => {
    // A leftover note from an earlier run would make the new one a name collision.
    rmSync(join(fixtureWorkspace, 'Ink Canvas Note.md'), { force: true })
    rmSync(join(fixtureWorkspace, 'Ink Canvas Note.ink'), { recursive: true, force: true })
    await browser.execute(() => {
      const button = Array.from(document.querySelectorAll('.sidebar button')).find((el) =>
        el.textContent?.includes('Canvas'),
      )
      if (!(button instanceof HTMLElement)) throw new Error('no Canvas button in the sidebar')
      button.click()
    })
    await fillPromptDialog('Ink Canvas Note')

    await waitForSelector('.ink-canvas-wrap', 'canvas note did not open inline')
    // The previous note's preview can outlive the first canvas paint while the switch settles.
    await browser.waitUntil(
      async () => browser.execute(() => !document.querySelector('.ink-preview')),
      { timeout: 10000, timeoutMsg: 'previous note preview never left the page' },
    )
    expect(await browser.execute(() => !!document.querySelector('.ink-editor-overlay'))).toBe(false)

    const notePath = join(fixtureWorkspace, 'Ink Canvas Note.md')
    await browser.waitUntil(() => existsSync(notePath), { timeout: 10000, timeoutMsg: 'canvas note never created' })
    expect(readFileSync(notePath, 'utf-8')).toContain('"inline":true')
    expect(readdirSync(fixtureWorkspace).some((name) => name === 'Ink Canvas Note.ink')).toBe(true)
    await screenshot('ink-fullscreen-canvas-note-inline')
  })
})
