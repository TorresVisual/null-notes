import { describe, it, expect } from 'vitest'
import {
  MAX_SCALE,
  MIN_SCALE,
  clampScale,
  fitCamera,
  isVisible,
  panBy,
  screenToWorld,
  worldToScreen,
  zoomAbout,
} from './camera'
import type { Camera } from './camera'
import { EMPTY_BOUNDS } from './growCanvas'

const VIEWPORT = { width: 1000, height: 500 }

function sampleCameras(): Camera[] {
  const offsets = [-100000, -1234.5, 0, 77.25, 100000]
  const scales = [MIN_SCALE, 0.37, 1, 2.5, MAX_SCALE]
  const cameras: Camera[] = []
  offsets.forEach((x, i) => {
    scales.forEach((scale, j) => cameras.push({ x, y: offsets[(i + j) % offsets.length] ?? 0, scale }))
  })
  return cameras
}

describe('clampScale', () => {
  it('bounds the range to 0.1–8', () => {
    expect(clampScale(0.01)).toBe(MIN_SCALE)
    expect(clampScale(99)).toBe(MAX_SCALE)
    expect(clampScale(1.5)).toBe(1.5)
    expect(MIN_SCALE).toBe(0.1)
    expect(MAX_SCALE).toBe(8)
  })
})

describe('screenToWorld / worldToScreen', () => {
  it('are inverses', () => {
    for (const camera of sampleCameras()) {
      const p = { x: 321.5, y: -45.25 }
      const s = worldToScreen(camera, p.x, p.y)
      const back = screenToWorld(camera, s.x, s.y)
      expect(back.x).toBeCloseTo(p.x, 6)
      expect(back.y).toBeCloseTo(p.y, 6)
    }
  })

  it('maps the camera origin to the screen origin', () => {
    expect(worldToScreen({ x: 50, y: 20, scale: 2 }, 50, 20)).toEqual({ x: 0, y: 0 })
    expect(worldToScreen({ x: 50, y: 20, scale: 2 }, 60, 30)).toEqual({ x: 20, y: 20 })
  })
})

describe('zoomAbout', () => {
  it('keeps the world point under the anchor fixed for 20+ cameras, at both limits', () => {
    for (const camera of sampleCameras()) {
      for (const next of [MIN_SCALE, 0.5, 3, MAX_SCALE]) {
        const before = screenToWorld(camera, 600, 100)
        const zoomed = zoomAbout(camera, 600, 100, next)
        const after = screenToWorld(zoomed, 600, 100)
        expect(zoomed.scale).toBe(clampScale(next))
        expect(after.x).toBeCloseTo(before.x, 6)
        expect(after.y).toBeCloseTo(before.y, 6)
      }
    }
  })

  it('clamps past a limit and still holds the anchor', () => {
    const camera: Camera = { x: 10, y: 20, scale: 4 }
    const before = screenToWorld(camera, 300, 200)
    const zoomed = zoomAbout(camera, 300, 200, 100)
    expect(zoomed.scale).toBe(MAX_SCALE)
    const after = screenToWorld(zoomed, 300, 200)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })
})

describe('panBy', () => {
  it('moves the content with the finger', () => {
    const camera: Camera = { x: 100, y: 50, scale: 2 }
    const panned = panBy(camera, 10, 0)
    expect(panned.x).toBe(camera.x - 10 / camera.scale)
    expect(panned.y).toBe(camera.y)
    const p = worldToScreen(camera, 0, 0)
    const moved = worldToScreen(panned, 0, 0)
    expect(moved.x - p.x).toBeCloseTo(10, 9)
  })
})

describe('fitCamera', () => {
  it('has finite fields for empty bounds and centres the world origin at scale 1', () => {
    const camera = fitCamera(EMPTY_BOUNDS, VIEWPORT, 1)
    expect(Number.isFinite(camera.x)).toBe(true)
    expect(Number.isFinite(camera.y)).toBe(true)
    expect(camera.scale).toBe(1)
    expect(worldToScreen(camera, 0, 0)).toEqual({ x: 500, y: 250 })
  })

  it('scales a box down to fit and centres it', () => {
    const camera = fitCamera({ minX: 0, minY: 0, maxX: 2000, maxY: 1000 }, VIEWPORT, 1)
    expect(camera.scale).toBe(0.5)
    expect(worldToScreen(camera, 1000, 500)).toEqual({ x: 500, y: 250 })
  })

  it('caps the scale at maxScale for small ink', () => {
    const camera = fitCamera({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, VIEWPORT, 1)
    expect(camera.scale).toBe(1)
    expect(worldToScreen(camera, 50, 50).x).toBeCloseTo(500, 9)
  })

  it('stays finite for a single point and a zero-size viewport', () => {
    const point = fitCamera({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, VIEWPORT, 1)
    expect(point.scale).toBe(1)
    const flat = fitCamera({ minX: 0, minY: 0, maxX: 0, maxY: 0 }, { width: 0, height: 0 }, 1)
    expect(Number.isFinite(flat.x) && Number.isFinite(flat.y) && Number.isFinite(flat.scale)).toBe(true)
  })
})

describe('isVisible', () => {
  const camera: Camera = { x: 0, y: 0, scale: 1 }

  it('is true for overlapping bounds, including partial overlap', () => {
    expect(isVisible(camera, VIEWPORT, { minX: 100, minY: 100, maxX: 200, maxY: 200 })).toBe(true)
    expect(isVisible(camera, VIEWPORT, { minX: 900, minY: 400, maxX: 1500, maxY: 900 })).toBe(true)
  })

  it('is false for disjoint bounds and for empty bounds', () => {
    expect(isVisible(camera, VIEWPORT, { minX: 2000, minY: 0, maxX: 2100, maxY: 10 })).toBe(false)
    expect(isVisible(camera, VIEWPORT, { minX: -300, minY: 0, maxX: -1, maxY: 10 })).toBe(false)
    expect(isVisible(camera, VIEWPORT, EMPTY_BOUNDS)).toBe(false)
  })

  it('accounts for scale', () => {
    expect(isVisible({ x: 0, y: 0, scale: 0.1 }, VIEWPORT, { minX: 5000, minY: 0, maxX: 5100, maxY: 10 })).toBe(true)
    expect(isVisible({ x: 0, y: 0, scale: 8 }, VIEWPORT, { minX: 5000, minY: 0, maxX: 5100, maxY: 10 })).toBe(false)
  })
})
