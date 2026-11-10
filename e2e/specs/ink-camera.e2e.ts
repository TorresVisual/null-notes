import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { screenshot } from '../screenshot.js'
import { fillPromptDialog } from '../promptDialog.js'
import { clickNewMenuItem } from '../sidebar.js'

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

interface Point {
  x: number
  y: number
}

// The overlay canvas is the whole editor body, so its top-left is the origin of
// every screen position this spec uses.
async function canvasOrigin(): Promise<Point> {
  return browser.execute(() => {
    const canvas = document.querySelector('.ink-editor-overlay canvas')
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('no overlay canvas')
    const rect = canvas.getBoundingClientRect()
    return { x: Math.round(rect.left), y: Math.round(rect.top) }
  })
}

// Real pen input, as in ink-fullscreen-editor.e2e.ts: a zigzag so auto-straighten
// leaves it a stroke. Returns where its first vertex landed, in client pixels.
async function drawMarker(): Promise<Point> {
  const origin = await canvasOrigin()
  const start = { x: origin.x + 200, y: origin.y + 200 }
  const pen = browser.action('pointer', { parameters: { pointerType: 'pen' } })
  pen.move({ x: start.x, y: start.y, origin: 'viewport' }).down({ button: 0 })
  for (let i = 1; i <= 20; i++) {
    pen.move({ x: start.x + i * 15, y: start.y + (i % 2 ? 60 : 0), origin: 'viewport' })
  }
  pen.up({ button: 0 })
  await pen.perform()
  return start
}

// A wheel event reaches the camera exactly as a mouse or trackpad one does; the
// driver has no reliable way to hold Ctrl through a wheel action.
async function wheel(at: Point, deltaY: number, ctrlKey: boolean): Promise<void> {
  await browser.execute(
    (x, y, dy, ctrl) => {
      const surface = document.querySelector('.ink-editor-overlay .ink-canvas-wrap')
      if (!surface) throw new Error('no canvas surface')
      surface.dispatchEvent(
        new WheelEvent('wheel', { clientX: x, clientY: y, deltaY: dy, ctrlKey: ctrl, bubbles: true, cancelable: true }),
      )
    },
    at.x,
    at.y,
    deltaY,
    ctrlKey,
  )
}

// Whether the pixel under a client position differs clearly from the canvas
// background — i.e. whether ink is painted there.
async function inkAt(at: Point): Promise<boolean> {
  return browser.execute(
    (x, y) => {
      const canvas = document.querySelector('.ink-editor-overlay canvas')
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('no overlay canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no 2d context')
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const px = ctx.getImageData(Math.round((x - rect.left) * dpr), Math.round((y - rect.top) * dpr), 1, 1).data
      const bg = getComputedStyle(canvas).backgroundColor.match(/\d+/g)?.map(Number) ?? [0, 0, 0]
      const diff = Math.max(Math.abs((px[0] ?? 0) - (bg[0] ?? 0)), Math.abs((px[1] ?? 0) - (bg[1] ?? 0)), Math.abs((px[2] ?? 0) - (bg[2] ?? 0)))
      return diff >= 60
    },
    at.x,
    at.y,
  )
}

async function zoomLabel(): Promise<string> {
  return browser.execute(() => document.querySelector('.ink-zoom-btn')?.textContent ?? '')
}

describe('ink camera', () => {
  const notePath = join(fixtureWorkspace, 'Ink Camera.md')
  const sidecarDirPath = join(fixtureWorkspace, 'Ink Camera.ink')

  it('zooms about the cursor, pans with the wheel, draws, and previews after Done', async () => {
    rmSync(notePath, { force: true })
    rmSync(sidecarDirPath, { recursive: true, force: true })
    await clickNewMenuItem('Note')
    await fillPromptDialog('Ink Camera')
    await focusEditorEnd()
    await browser.keys(['End', 'Enter'])

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
    expect(await browser.execute(() => !!document.querySelector('.ink-canvas-wrap'))).toBe(true)

    // Pen is the default tool; the marker is the thing whose position we track.
    const marker = await drawMarker()
    await browser.waitUntil(async () => inkAt(marker), { timeout: 5000, timeoutMsg: 'marker was never painted' })
    await screenshot('ink-camera-marker')

    // Zoom in about the marker: the pixel under the cursor must stay inked.
    expect(await zoomLabel()).toBe('100%')
    await wheel(marker, -400, true)
    await browser.waitUntil(async () => (await zoomLabel()) !== '100%', { timeout: 5000, timeoutMsg: 'Ctrl+wheel did not zoom' })
    await browser.pause(200)
    expect(await inkAt(marker)).toBe(true)
    await screenshot('ink-camera-zoomed-at-marker')

    // A plain wheel pans: the marker leaves its place by the wheel travel.
    await wheel(marker, 150, false)
    await browser.waitUntil(async () => !(await inkAt(marker)), { timeout: 5000, timeoutMsg: 'plain wheel did not pan' })
    expect(await inkAt({ x: marker.x, y: marker.y - 150 })).toBe(true)
    await screenshot('ink-camera-panned')

    await clickInPage('.ink-editor-done')
    await browser.waitUntil(
      async () => browser.execute(() => !document.querySelector('.ink-editor-overlay')),
      { timeout: 5000, timeoutMsg: 'overlay never closed' },
    )
    await waitForSelector('.ink-preview-page svg path', 'preview never showed the stroke')
    expect(await browser.execute(() => !!document.querySelector('.ink-canvas-wrap'))).toBe(false)
    await screenshot('ink-camera-preview')

    // The drawing's own file, with the extent following the ink rather than a fixed page.
    const sidecarDir = join(fixtureWorkspace, 'Ink Camera.ink')
    await browser.waitUntil(
      () =>
        existsSync(sidecarDir) &&
        readdirSync(sidecarDir).some((name) => {
          const svg = readFileSync(join(sidecarDir, name), 'utf-8')
          return svg.includes('data-points') && !svg.includes('data-width="700"')
        }),
      { timeout: 10000, interval: 300, timeoutMsg: 'sidecar never saved the stroke with an ink-sized extent' },
    )
  })
})
