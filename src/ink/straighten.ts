import type { Point } from './types'

// OneNote's own behaviour, mirrored here: no "almost straight" state — a
// stroke either clears the threshold and becomes a line, or it doesn't and
// stays freehand. Deviation is measured perpendicular to the chord between
// the stroke's own endpoints and normalised by chord length, so the check
// scales with stroke size rather than a fixed pixel budget.
const MAX_DEVIATION_RATIO = 0.04

export function straightLineEnds(points: Point[]): { x1: number; y1: number; x2: number; y2: number } | null {
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) return null
  const dx = last.x - first.x
  const dy = last.y - first.y
  const length = Math.hypot(dx, dy)
  if (length < 1) return null

  const maxDeviation = points.reduce((max, p) => {
    const dist = Math.abs(dx * (p.y - first.y) - dy * (p.x - first.x)) / length
    return Math.max(max, dist)
  }, 0)

  return maxDeviation / length <= MAX_DEVIATION_RATIO
    ? { x1: first.x, y1: first.y, x2: last.x, y2: last.y }
    : null
}
