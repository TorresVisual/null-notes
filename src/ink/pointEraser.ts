import { hitTestShape } from './hitTest'
import type { EraserMode, InkData, Point, Stroke } from './types'

// A stroke is a run of points, so erasing part of it is a split, not a delete:
// drop the points under the eraser and every surviving run becomes a stroke of
// its own. Rubbing out one letter of a word should not take the word with it.
export function splitStrokePoints(
  points: Point[],
  x: number,
  y: number,
  radius: number,
): Point[][] {
  const runs: Point[][] = []
  let run: Point[] = []

  for (const p of points) {
    if (Math.hypot(p.x - x, p.y - y) <= radius) {
      if (run.length > 0) runs.push(run)
      run = []
      continue
    }
    run.push(p)
  }
  if (run.length > 0) runs.push(run)

  // A lone surviving point is a dot with no direction — perfect-freehand has
  // nothing to outline, and it is the same rule that discards a stray tap.
  return runs.filter((r) => r.length >= 2)
}

export function eraseFromStroke(
  stroke: Stroke,
  x: number,
  y: number,
  radius: number,
  nextId: () => string,
): Stroke[] {
  const runs = splitStrokePoints(stroke.points, x, y, radius)
  if (runs.length === 1 && runs[0]?.length === stroke.points.length) return [stroke]
  return runs.map((points, i) => ({
    ...stroke,
    // The first fragment inherits the identity; the rest are genuinely new
    // strokes, and need ids that cannot collide with a later split.
    id: i === 0 ? stroke.id : nextId(),
    points,
  }))
}

function touchesStroke(stroke: Stroke, x: number, y: number, radius: number): boolean {
  return stroke.points.some((p) => Math.hypot(p.x - x, p.y - y) <= radius)
}

// The stroke eraser: touch any part of a stroke and the whole thing goes. It is
// the faster way to scratch out a word, and the only way to be rid of a stroke
// without leaving crumbs of it behind.
export function eraseWholeStrokes(data: InkData, x: number, y: number, radius: number): InkData {
  const strokes = data.strokes.filter((s) => !touchesStroke(s, x, y, radius))
  const shapes = data.shapes.filter((s) => !hitTestShape(s, x, y, radius))
  if (strokes.length === data.strokes.length && shapes.length === data.shapes.length) {
    return data
  }
  return { ...data, strokes, shapes }
}

export function erase(
  data: InkData,
  x: number,
  y: number,
  radius: number,
  mode: EraserMode,
  nextId: () => string,
): InkData {
  return mode === 'stroke'
    ? eraseWholeStrokes(data, x, y, radius)
    : erasePoint(data, x, y, radius, nextId)
}

// Shapes have no points to split — a rectangle cut in half is not a rectangle —
// so they are still erased whole, by the same hit test the eraser always used.
export function erasePoint(
  data: InkData,
  x: number,
  y: number,
  radius: number,
  nextId: () => string,
): InkData {
  const strokes = data.strokes.flatMap((s) => eraseFromStroke(s, x, y, radius, nextId))
  const shapes = data.shapes.filter((s) => !hitTestShape(s, x, y, radius))

  const unchanged =
    shapes.length === data.shapes.length &&
    strokes.length === data.strokes.length &&
    strokes.every((s, i) => s === data.strokes[i])
  if (unchanged) return data

  return { ...data, strokes, shapes }
}
