import { pointToSegmentDistance } from './hitTest'
import type { Point } from './types'

export interface Ruler {
  x: number
  y: number
  angle: number
  length: number
}

export const DEFAULT_RULER_LENGTH = 520

// The band is the ruler you can see and grab; the snap zone is the margin just
// outside it where a stroke is taken as running along the edge. They must not
// be the same number — a pen landing on the band moves the ruler instead of
// drawing, so if snapping stopped where the band did there would be nowhere
// left to draw against it.
export const RULER_BAND = 36
export const GRAB_DISTANCE = RULER_BAND / 2
export const SNAP_DISTANCE = 48

export function centredRuler(width: number, height: number): Ruler {
  return { x: width / 2, y: height / 2, angle: 0, length: DEFAULT_RULER_LENGTH }
}

export function rulerEndpoints(ruler: Ruler): [{ x: number; y: number }, { x: number; y: number }] {
  const half = ruler.length / 2
  const dx = Math.cos(ruler.angle) * half
  const dy = Math.sin(ruler.angle) * half
  return [
    { x: ruler.x - dx, y: ruler.y - dy },
    { x: ruler.x + dx, y: ruler.y + dy },
  ]
}

export function distanceToRuler(x: number, y: number, ruler: Ruler): number {
  const [a, b] = rulerEndpoints(ruler)
  return pointToSegmentDistance(x, y, a.x, a.y, b.x, b.y)
}

// Where along the ruler a point falls, 0 at one end and 1 at the other. Used to
// tell "grab the middle to slide it" from "grab an end to swing it".
export function positionAlong(x: number, y: number, ruler: Ruler): number {
  const [a, b] = rulerEndpoints(ruler)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return 0
  const t = ((x - a.x) * dx + (y - a.y) * dy) / lengthSq
  return Math.max(0, Math.min(1, t))
}

export type RulerGrab = 'move' | 'rotate' | null

export function grabKind(x: number, y: number, ruler: Ruler): RulerGrab {
  if (distanceToRuler(x, y, ruler) > GRAB_DISTANCE) return null
  const t = positionAlong(x, y, ruler)
  return t < 0.25 || t > 0.75 ? 'rotate' : 'move'
}

export function moveRuler(ruler: Ruler, dx: number, dy: number): Ruler {
  return { ...ruler, x: ruler.x + dx, y: ruler.y + dy }
}

// Swinging an end points the ruler at the pen and pivots about the centre, so
// the straightedge stays where you put it while the angle changes.
export function rotateRulerTowards(ruler: Ruler, x: number, y: number): Ruler {
  const angle = Math.atan2(y - ruler.y, x - ruler.x)
  const t = positionAlong(x, y, ruler)
  return { ...ruler, angle: t < 0.5 ? angle + Math.PI : angle }
}

// The whole stroke is judged by where it began. Deciding per point would let a
// line drift on and off the edge mid-stroke, which is worse than either
// snapping or not.
export function shouldSnap(start: Point, ruler: Ruler): boolean {
  return distanceToRuler(start.x, start.y, ruler) <= SNAP_DISTANCE
}

// The foot of the perpendicular onto the ruler's line, extended past its ends —
// running off the edge should keep the line straight rather than pile every
// remaining point onto the last inch of the ruler.
export function projectOntoRuler(point: Point, ruler: Ruler): Point {
  const dx = Math.cos(ruler.angle)
  const dy = Math.sin(ruler.angle)
  const t = (point.x - ruler.x) * dx + (point.y - ruler.y) * dy
  return { ...point, x: ruler.x + dx * t, y: ruler.y + dy * t }
}

export function snapStroke(points: Point[], ruler: Ruler): Point[] {
  return points.map((p) => projectOntoRuler(p, ruler))
}
