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

export const CROP_PADDING = 40

// Shrinks the page to the ink plus padding by moving the origin, so no stored
// coordinate changes. An empty page has nothing to crop to and is left alone.
export function cropToContent(data: InkData): InkData {
  const b = inkBounds(data)
  if (b.minX === Infinity) return data
  const originX = Math.floor(b.minX - CROP_PADDING)
  const originY = Math.floor(b.minY - CROP_PADDING)
  return {
    ...data,
    originX,
    originY,
    width: Math.ceil(b.maxX + CROP_PADDING) - originX,
    height: Math.ceil(b.maxY + CROP_PADDING) - originY,
  }
}

export const MIN_EXTENT = 200

function extentAxis(min: number, max: number): { origin: number; size: number } {
  const origin = Math.floor(min - CROP_PADDING)
  const size = Math.ceil(max + CROP_PADDING) - origin
  if (size >= MIN_EXTENT) return { origin, size }
  return { origin: origin - Math.floor((MIN_EXTENT - size) / 2), size: MIN_EXTENT }
}

// The saved extent follows the ink: bounds plus padding, never smaller than
// MIN_EXTENT so a lone dot isn't a speck in the preview. Only the declared
// origin and size change; no stored coordinate moves.
export function extentOf(data: InkData): InkData {
  const b = inkBounds(data)
  if (b.minX === Infinity) return { ...data, originX: 0, originY: 0, width: MIN_EXTENT, height: MIN_EXTENT }
  const x = extentAxis(b.minX, b.maxX)
  const y = extentAxis(b.minY, b.maxY)
  return { ...data, originX: x.origin, originY: y.origin, width: x.size, height: y.size }
}

// Growing left or up adds screen space *before* the existing ink, so the scroll
// position has to advance by the same amount or everything drawn jumps. Keyed on
// any origin change — undo and redo restore the old origin and so shift back.
export function scrollShift(
  prev: { originX: number; originY: number },
  next: { originX: number; originY: number },
  zoom: number,
): { dx: number; dy: number } {
  return { dx: (prev.originX - next.originX) * zoom, dy: (prev.originY - next.originY) * zoom }
}
