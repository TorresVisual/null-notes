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

// Exponential, so equal wheel travel is an equal ratio at any zoom level.
export function wheelZoom(zoom: number, deltaY: number): number {
  return clampZoom(zoom * Math.exp(-deltaY * 0.002))
}

const KEY_ZOOM_STEP = 1.25

// Ctrl/Cmd + / - / 0 → the next zoom, or null for any other key.
export function zoomForKey(key: string, zoom: number): number | null {
  if (key === '+' || key === '=') return clampZoom(Math.round(zoom * KEY_ZOOM_STEP * 100) / 100)
  if (key === '-' || key === '_') return clampZoom(Math.round((zoom / KEY_ZOOM_STEP) * 100) / 100)
  if (key === '0') return 1
  return null
}

// A point `anchor` ink units from the page origin sits at `anchor * zoom` pixels,
// so changing zoom moves it by `anchor * Δzoom`. Scrolling by that much keeps it
// under the cursor or fingers instead of the page growing away from its corner.
export function anchorShift(anchor: number, fromZoom: number, toZoom: number): number {
  return anchor * (toZoom - fromZoom)
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
