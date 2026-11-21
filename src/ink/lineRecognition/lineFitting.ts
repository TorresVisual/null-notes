import type { XY } from './types'

export interface FittedLine {
  cx: number
  cy: number
  /** Unit direction of the line. */
  ux: number
  uy: number
}

// Orthogonal least squares: the principal axis of the points' covariance, so
// error is measured perpendicular to the line and a vertical stroke fits as
// well as a horizontal one (y-on-x regression cannot).
export function fitLine(points: readonly XY[]): FittedLine {
  const n = points.length
  let cx = 0
  let cy = 0
  for (const p of points) {
    cx += p.x
    cy += p.y
  }
  cx /= n
  cy /= n
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (const p of points) {
    const dx = p.x - cx
    const dy = p.y - cy
    sxx += dx * dx
    syy += dy * dy
    sxy += dx * dy
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  return { cx, cy, ux: Math.cos(angle), uy: Math.sin(angle) }
}

export function perpendicularDistance(line: FittedLine, p: XY): number {
  return Math.abs((p.x - line.cx) * line.uy - (p.y - line.cy) * line.ux)
}

export function projectOnto(line: FittedLine, p: XY): XY {
  const along = (p.x - line.cx) * line.ux + (p.y - line.cy) * line.uy
  return { x: line.cx + line.ux * along, y: line.cy + line.uy * along }
}
