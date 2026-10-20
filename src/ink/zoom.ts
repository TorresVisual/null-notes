export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 3

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

// Scale relative to where the pinch started rather than the previous frame, so
// rounding cannot accumulate across a long gesture and drift the zoom.
export function pinchZoom(startZoom: number, startDistance: number, distance: number): number {
  if (startDistance <= 0) return clampZoom(startZoom)
  return clampZoom(Math.round(startZoom * (distance / startDistance) * 100) / 100)
}

export function distanceBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export const MAX_CANVAS_DIMENSION = 16384
export const MAX_CANVAS_PIXELS = 64_000_000

// A canvas has a per-axis size limit and, in practice, a memory budget: an
// 8000 × 8000 page at dpr 2 would be ~1 GB of RGBA. Past either, sharpness drops
// rather than the canvas failing to render.
export function backingScale(dpr: number, zoom: number, width: number, height: number): number {
  return Math.min(
    dpr * zoom,
    MAX_CANVAS_DIMENSION / Math.max(width, height),
    Math.sqrt(MAX_CANVAS_PIXELS / (width * height)),
  )
}
