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

export function deleteSelection(data: InkData, selection: Selection): InkData {
  return {
    ...data,
    strokes: data.strokes.filter((s) => !selection.strokeIds.includes(s.id)),
    shapes: data.shapes.filter((s) => !selection.shapeIds.includes(s.id)),
  }
}

// The lowest point the selection reaches, so a drag towards the bottom edge can
// grow the page instead of pushing ink off it.
export function selectionBottom(data: InkData, selection: Selection): number {
  let bottom = 0
  for (const stroke of data.strokes) {
    if (!selection.strokeIds.includes(stroke.id)) continue
    for (const p of stroke.points) bottom = Math.max(bottom, p.y)
  }
  for (const shape of data.shapes) {
    if (!selection.shapeIds.includes(shape.id)) continue
    bottom = Math.max(bottom, shape.y1, shape.y2)
  }
  return bottom
}
