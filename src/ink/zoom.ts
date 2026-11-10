import { clampScale } from './camera'

// Scale relative to where the pinch started rather than the previous frame, so
// rounding cannot accumulate across a long gesture and drift the zoom.
export function pinchZoom(startZoom: number, startDistance: number, distance: number): number {
  if (startDistance <= 0) return clampScale(startZoom)
  return clampScale(Math.round(startZoom * (distance / startDistance) * 100) / 100)
}

// Exponential, so equal wheel travel is an equal ratio at any zoom level.
export function wheelZoom(zoom: number, deltaY: number): number {
  return clampScale(zoom * Math.exp(-deltaY * 0.002))
}

const KEY_ZOOM_STEP = 1.25

// Ctrl/Cmd + / - / 0 → the next zoom, or null for any other key.
export function zoomForKey(key: string, zoom: number): number | null {
  if (key === '+' || key === '=') return clampScale(Math.round(zoom * KEY_ZOOM_STEP * 100) / 100)
  if (key === '-' || key === '_') return clampScale(Math.round((zoom / KEY_ZOOM_STEP) * 100) / 100)
  if (key === '0') return 1
  return null
}

export function distanceBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
