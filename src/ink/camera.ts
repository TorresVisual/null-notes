import type { Bounds } from './bounds'

// screen = (world − (x, y)) · scale
export interface Camera {
  x: number
  y: number
  scale: number
}

export interface Viewport {
  width: number
  height: number
}

export const MIN_SCALE = 0.1
export const MAX_SCALE = 8

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

export function screenToWorld(camera: Camera, sx: number, sy: number): { x: number; y: number } {
  return { x: sx / camera.scale + camera.x, y: sy / camera.scale + camera.y }
}

export function worldToScreen(camera: Camera, x: number, y: number): { x: number; y: number } {
  return { x: (x - camera.x) * camera.scale, y: (y - camera.y) * camera.scale }
}

export function zoomAbout(camera: Camera, sx: number, sy: number, nextScale: number): Camera {
  const scale = clampScale(nextScale)
  const anchor = screenToWorld(camera, sx, sy)
  return { x: anchor.x - sx / scale, y: anchor.y - sy / scale, scale }
}

export function panBy(camera: Camera, dxScreen: number, dyScreen: number): Camera {
  return { ...camera, x: camera.x - dxScreen / camera.scale, y: camera.y - dyScreen / camera.scale }
}

export function fitCamera(bounds: Bounds, viewport: Viewport, maxScale: number): Camera {
  if (bounds.minX === Infinity) {
    return { x: -viewport.width / 2, y: -viewport.height / 2, scale: 1 }
  }
  const raw = Math.min(
    maxScale,
    viewport.width / (bounds.maxX - bounds.minX),
    viewport.height / (bounds.maxY - bounds.minY),
  )
  const scale = clampScale(Number.isFinite(raw) ? raw : maxScale)
  return {
    x: (bounds.minX + bounds.maxX) / 2 - viewport.width / (2 * scale),
    y: (bounds.minY + bounds.maxY) / 2 - viewport.height / (2 * scale),
    scale,
  }
}

export function isVisible(camera: Camera, viewport: Viewport, bounds: Bounds): boolean {
  const right = camera.x + viewport.width / camera.scale
  const bottom = camera.y + viewport.height / camera.scale
  return bounds.maxX >= camera.x && bounds.minX <= right && bounds.maxY >= camera.y && bounds.minY <= bottom
}
