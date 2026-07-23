import type { Shape } from './types'

export function pointToSegmentDistance(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return Math.hypot(px - x1, py - y1)
  let t = ((px - x1) * dx + (py - y1) * dy) / lengthSq
  t = Math.max(0, Math.min(1, t))
  const closestX = x1 + t * dx
  const closestY = y1 + t * dy
  return Math.hypot(px - closestX, py - closestY)
}

export function hitTestShape(shape: Shape, x: number, y: number, radius: number): boolean {
  switch (shape.kind) {
    case 'line':
    case 'arrow':
      return pointToSegmentDistance(x, y, shape.x1, shape.y1, shape.x2, shape.y2) <= radius
    case 'rect': {
      const left = Math.min(shape.x1, shape.x2)
      const right = Math.max(shape.x1, shape.x2)
      const top = Math.min(shape.y1, shape.y2)
      const bottom = Math.max(shape.y1, shape.y2)
      const edges: [number, number, number, number][] = [
        [left, top, right, top],
        [right, top, right, bottom],
        [right, bottom, left, bottom],
        [left, bottom, left, top],
      ]
      return edges.some(([ex1, ey1, ex2, ey2]) => pointToSegmentDistance(x, y, ex1, ey1, ex2, ey2) <= radius)
    }
    case 'circle': {
      const cx = (shape.x1 + shape.x2) / 2
      const cy = (shape.y1 + shape.y2) / 2
      const rx = Math.abs(shape.x2 - shape.x1) / 2
      const ry = Math.abs(shape.y2 - shape.y1) / 2
      if (rx === 0 || ry === 0) return Math.hypot(x - cx, y - cy) <= radius
      const dx = (x - cx) / rx
      const dy = (y - cy) / ry
      const normalizedDist = Math.hypot(dx, dy)
      return Math.abs(normalizedDist - 1) * Math.min(rx, ry) <= radius
    }
  }
}
