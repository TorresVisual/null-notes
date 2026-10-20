// A page grows outward from its fixed (0, 0) origin, in whichever direction
// content is approaching it from — bottom and right, the two edges paper
// naturally grows towards as you write (P13-4's decision: see docs/ROADMAP.md
// for the full record). Growing the other two edges would need every
// existing stroke/shape/text translated by the growth amount, *and* the
// scroll position compensated by that same amount so nothing already drawn
// visually jumps — a materially riskier mechanism than "make the box
// bigger," which is all bottom/right growth has ever needed, and one this
// deliberately does not attempt.
import { boundsOfTextItem } from './textBounds'
import type { InkData } from './types'

export const GROW_MARGIN = 160
export const PAGE_STEP = 400

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

export function growCanvas(
  width: number,
  height: number,
  reach: Pick<Bounds, 'maxX' | 'maxY'>,
  autoGrow: boolean,
): { width: number; height: number } {
  if (!autoGrow) return { width, height }
  return {
    width: reach.maxX > width - GROW_MARGIN ? width + PAGE_STEP : width,
    height: reach.maxY > height - GROW_MARGIN ? height + PAGE_STEP : height,
  }
}
