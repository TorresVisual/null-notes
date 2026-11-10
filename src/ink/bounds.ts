// Ink bounds and the saved extent. Coordinates are never translated: the
// declared origin and size are the only things that follow the ink.
import { boundsOfTextItem } from './textBounds'
import type { InkData } from './types'

// Padding svgToInkData adds when a file written by an older build holds ink
// outside its declared origin.
export const GROW_MARGIN = 160

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

export const CROP_PADDING = 40

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
