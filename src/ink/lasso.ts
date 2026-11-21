import { EMPTY_BOUNDS, mergeBounds, boundsOfPoints, type Bounds } from './bounds'
import type { InkData, Shape, Stroke } from './types'

export interface LassoPoint {
  x: number
  y: number
}

export interface Selection {
  strokeIds: string[]
  shapeIds: string[]
}

export const EMPTY_SELECTION: Selection = { strokeIds: [], shapeIds: [] }

export function isSelectionEmpty(selection: Selection): boolean {
  return selection.strokeIds.length === 0 && selection.shapeIds.length === 0
}

// Ray casting: count the edges crossed by a ray heading in +x. An odd count
// means the point started inside. This handles the concave loops a freehand
// lasso actually produces, which a bounding box would not.
export function pointInPolygon(x: number, y: number, polygon: LassoPoint[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    if (!a || !b) continue
    const straddles = a.y > y !== b.y > y
    if (straddles && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

// Containment, not intersection: a stroke you only clipped the tail of stays
// put. Half-grabbing a line of writing because the loop brushed it is worse
// than having to circle it properly.
export function strokeInLasso(stroke: Stroke, polygon: LassoPoint[]): boolean {
  return (
    stroke.points.length > 0 &&
    stroke.points.every((p) => pointInPolygon(p.x, p.y, polygon))
  )
}

function shapeCorners(shape: Shape): LassoPoint[] {
  if (shape.kind === 'line' || shape.kind === 'arrow') {
    return [
      { x: shape.x1, y: shape.y1 },
      { x: shape.x2, y: shape.y2 },
    ]
  }
  return [
    { x: shape.x1, y: shape.y1 },
    { x: shape.x2, y: shape.y1 },
    { x: shape.x2, y: shape.y2 },
    { x: shape.x1, y: shape.y2 },
  ]
}

export function shapeInLasso(shape: Shape, polygon: LassoPoint[]): boolean {
  return shapeCorners(shape).every((c) => pointInPolygon(c.x, c.y, polygon))
}

// A lasso needs three points to enclose anything; a tap or a straight flick
// encloses nothing and must clear the selection rather than select the page.
export function selectionIn(data: InkData, polygon: LassoPoint[]): Selection {
  if (polygon.length < 3) return EMPTY_SELECTION
  return {
    strokeIds: data.strokes.filter((s) => strokeInLasso(s, polygon)).map((s) => s.id),
    shapeIds: data.shapes.filter((s) => shapeInLasso(s, polygon)).map((s) => s.id),
  }
}

export function translatePolygon(polygon: LassoPoint[], dx: number, dy: number): LassoPoint[] {
  return polygon.map((p) => ({ x: p.x + dx, y: p.y + dy }))
}

export function translateSelection(
  data: InkData,
  selection: Selection,
  dx: number,
  dy: number,
): InkData {
  return {
    ...data,
    strokes: data.strokes.map((s) =>
      selection.strokeIds.includes(s.id)
        ? { ...s, points: s.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) }
        : s,
    ),
    shapes: data.shapes.map((s) =>
      selection.shapeIds.includes(s.id)
        ? { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy }
        : s,
    ),
  }
}

// The copies land offset so they read as copies rather than as nothing having
// happened, and are what ends up selected — one drag from where you want them.
export function duplicateSelection(
  data: InkData,
  selection: Selection,
  dx: number,
  dy: number,
  newId: () => string,
): { data: InkData; selection: Selection } {
  const strokes = data.strokes
    .filter((s) => selection.strokeIds.includes(s.id))
    .map((s) => ({ ...s, id: newId(), points: s.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) }))
  const shapes = data.shapes
    .filter((s) => selection.shapeIds.includes(s.id))
    .map((s) => ({ ...s, id: newId(), x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy }))
  return {
    data: { ...data, strokes: [...data.strokes, ...strokes], shapes: [...data.shapes, ...shapes] },
    selection: { strokeIds: strokes.map((s) => s.id), shapeIds: shapes.map((s) => s.id) },
  }
}

// Geometry scales, line width does not: enlarging a drawing should not also
// fatten the pen it was drawn with.
export function scaleSelection(
  data: InkData,
  selection: Selection,
  factor: number,
  ax: number,
  ay: number,
): InkData {
  const sx = (x: number) => ax + (x - ax) * factor
  const sy = (y: number) => ay + (y - ay) * factor
  return {
    ...data,
    strokes: data.strokes.map((s) =>
      selection.strokeIds.includes(s.id)
        ? { ...s, points: s.points.map((p) => ({ ...p, x: sx(p.x), y: sy(p.y) })) }
        : s,
    ),
    shapes: data.shapes.map((s) =>
      selection.shapeIds.includes(s.id)
        ? { ...s, x1: sx(s.x1), y1: sy(s.y1), x2: sx(s.x2), y2: sy(s.y2) }
        : s,
    ),
  }
}

export function scalePolygon(polygon: LassoPoint[], factor: number, ax: number, ay: number): LassoPoint[] {
  return polygon.map((p) => ({ x: ax + (p.x - ax) * factor, y: ay + (p.y - ay) * factor }))
}

const MIN_RESIZE_FACTOR = 0.1

// The pointer's progress along the frame's own top-left → bottom-right diagonal,
// so the aspect ratio holds however the pen wanders sideways.
export function resizeFactor(frame: Bounds, x: number, y: number): number {
  const dx = frame.maxX - frame.minX
  const dy = frame.maxY - frame.minY
  const length = dx * dx + dy * dy
  if (length === 0) return 1
  const along = ((x - frame.minX) * dx + (y - frame.minY) * dy) / length
  return Math.max(MIN_RESIZE_FACTOR, along)
}

export function deleteSelection(data: InkData, selection: Selection): InkData {
  return {
    ...data,
    strokes: data.strokes.filter((s) => !selection.strokeIds.includes(s.id)),
    shapes: data.shapes.filter((s) => !selection.shapeIds.includes(s.id)),
  }
}

// The extremes the selection covers on either axis, so a drag towards any edge
// can grow the page instead of pushing ink off it.
export function selectionBounds(data: InkData, selection: Selection): Bounds {
  let bounds = EMPTY_BOUNDS
  for (const stroke of data.strokes) {
    if (selection.strokeIds.includes(stroke.id)) bounds = mergeBounds(bounds, boundsOfPoints(stroke.points))
  }
  for (const shape of data.shapes) {
    if (!selection.shapeIds.includes(shape.id)) continue
    bounds = mergeBounds(bounds, boundsOfPoints([{ x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 }]))
  }
  return bounds
}
