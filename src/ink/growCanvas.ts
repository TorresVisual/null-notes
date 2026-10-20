// The page grows on a side when ink comes within GROW_MARGIN of it. Right and
// down just make the box bigger; left and up move the page's origin instead,
// so no stored coordinate is ever translated (see ink-infinite-page-design.md).
// Only the full-screen editor asks for all four sides — inline canvases and PDF
// pages keep a fixed origin.
import { boundsOfTextItem } from './textBounds'
import type { InkData } from './types'

export const GROW_MARGIN = 160
export const PAGE_STEP = 400
export const MAX_EXTENT = 8000

export interface Page {
  originX: number
  originY: number
  width: number
  height: number
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export const EMPTY_BOUNDS: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }

export function mergeBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }
}

export function boundsOfPoints(points: { x: number; y: number }[]): Bounds {
  return points.reduce(
    (bounds, p) => mergeBounds(bounds, { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y }),
    EMPTY_BOUNDS,
  )
}

export function inkBounds(data: InkData): Bounds {
  let bounds = EMPTY_BOUNDS
  for (const stroke of data.strokes) bounds = mergeBounds(bounds, boundsOfPoints(stroke.points))
  for (const s of data.shapes) {
    bounds = mergeBounds(bounds, boundsOfPoints([{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }]))
  }
  for (const item of data.texts) bounds = mergeBounds(bounds, boundsOfTextItem(item))
  return bounds
}

function stepsFor(needed: number): number {
  return needed > 0 ? Math.ceil(needed / PAGE_STEP) * PAGE_STEP : 0
}

function growAxis(origin: number, size: number, min: number, max: number, growStart: boolean) {
  const room = Math.max(0, Math.floor((MAX_EXTENT - size) / PAGE_STEP) * PAGE_STEP)
  const start = growStart ? Math.min(stepsFor(origin + GROW_MARGIN - min), room) : 0
  const end = Math.min(stepsFor(max - (origin + size - GROW_MARGIN)), room - start)
  return { origin: origin - start, size: size + start + end }
}

export function growCanvas(page: Page, bounds: Bounds, autoGrow: boolean, growAllSides: boolean): Page {
  if (!autoGrow) return page
  const x = growAxis(page.originX, page.width, bounds.minX, bounds.maxX, growAllSides)
  const y = growAxis(page.originY, page.height, bounds.minY, bounds.maxY, growAllSides)
  return { originX: x.origin, originY: y.origin, width: x.size, height: y.size }
}
