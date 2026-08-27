// A page grows outward from its fixed (0, 0) origin, in whichever direction
// content is approaching it from — bottom and right, the two edges paper
// naturally grows towards as you write (P13-4's decision: see docs/ROADMAP.md
// for the full record). Growing the other two edges would need every
// existing stroke/shape/text translated by the growth amount, *and* the
// scroll position compensated by that same amount so nothing already drawn
// visually jumps — a materially riskier mechanism than "make the box
// bigger," which is all bottom/right growth has ever needed, and one this
// deliberately does not attempt.
export const GROW_MARGIN = 160
export const PAGE_STEP = 400

export interface Reach {
  maxX: number
  maxY: number
}

export function reachOfPoints(points: { x: number; y: number }[]): Reach {
  return points.reduce(
    (reach, p) => ({ maxX: Math.max(reach.maxX, p.x), maxY: Math.max(reach.maxY, p.y) }),
    { maxX: 0, maxY: 0 },
  )
}

export function growCanvas(
  width: number,
  height: number,
  reach: Reach,
  autoGrow: boolean,
): { width: number; height: number } {
  if (!autoGrow) return { width, height }
  return {
    width: reach.maxX > width - GROW_MARGIN ? width + PAGE_STEP : width,
    height: reach.maxY > height - GROW_MARGIN ? height + PAGE_STEP : height,
  }
}
