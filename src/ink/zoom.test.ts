import { describe, it, expect } from 'vitest'
import { pinchZoom, distanceBetween, backingScale, anchorShift, wheelZoom, zoomForKey, MAX_CANVAS_DIMENSION, MAX_CANVAS_PIXELS } from './zoom'
import { MIN_SCALE, MAX_SCALE } from './camera'

describe('anchorShift', () => {
  it('scrolls by the anchor times the zoom change', () => {
    expect(anchorShift(100, 1, 2)).toBe(100)
    expect(anchorShift(100, 2, 1)).toBe(-100)
    expect(anchorShift(0, 1, 3)).toBe(0)
  })
})

describe('zoomForKey', () => {
  it('steps in and out, clamps, resets, and ignores other keys', () => {
    expect(zoomForKey('=', 1)).toBe(1.25)
    expect(zoomForKey('+', 1)).toBe(1.25)
    expect(zoomForKey('-', 1)).toBe(0.8)
    expect(zoomForKey('+', MAX_SCALE)).toBe(MAX_SCALE)
    expect(zoomForKey('-', MIN_SCALE)).toBe(MIN_SCALE)
    expect(zoomForKey('0', 2)).toBe(1)
    expect(zoomForKey('a', 1)).toBeNull()
  })
})

describe('wheelZoom', () => {
  it('zooms in on negative delta, out on positive, and clamps', () => {
    expect(wheelZoom(1, -100)).toBeGreaterThan(1)
    expect(wheelZoom(1, 100)).toBeLessThan(1)
    expect(wheelZoom(MAX_SCALE, -1000)).toBe(MAX_SCALE)
    expect(wheelZoom(MIN_SCALE, 1000)).toBe(MIN_SCALE)
  })
})

describe('pinchZoom', () => {
  it('scales with the spread of the fingers', () => {
    expect(pinchZoom(1, 100, 200)).toBe(2)
    expect(pinchZoom(1, 200, 100)).toBe(0.5)
  })

  it('holds still when the fingers do', () => {
    expect(pinchZoom(1.5, 120, 120)).toBe(1.5)
  })

  // Measuring from the start of the gesture, not the last frame, is what stops
  // a long pinch from drifting as rounding accumulates.
  it('does not drift across a gesture', () => {
    const once = pinchZoom(1, 100, 150)
    const stepwise = pinchZoom(pinchZoom(1, 100, 125), 125, 150)
    expect(once).toBe(1.5)
    expect(once).toBeCloseTo(stepwise, 1)
  })

  it('stays within the zoom limits', () => {
    expect(pinchZoom(1, 10, 1000)).toBe(MAX_SCALE)
    expect(pinchZoom(1, 1000, 10)).toBe(MIN_SCALE)
  })

  it('survives a degenerate first frame where both touches land together', () => {
    expect(pinchZoom(1.25, 0, 80)).toBe(1.25)
  })
})

describe('distanceBetween', () => {
  it('measures the gap between two touches', () => {
    expect(distanceBetween({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
  })
})

describe('backingScale', () => {
  it('is dpr × zoom for an ordinary page', () => {
    expect(backingScale(2, 1.5, 800, 600)).toBe(3)
  })

  it('is capped by the per-axis canvas limit for a long strip', () => {
    expect(backingScale(4, 1, 8000, 1000)).toBeCloseTo(MAX_CANVAS_DIMENSION / 8000)
  })

  it('is capped by the pixel budget for a big square page', () => {
    const scale = backingScale(2, 1, 8000, 8000)
    expect(scale).toBeCloseTo(Math.sqrt(MAX_CANVAS_PIXELS / (8000 * 8000)))
    expect(8000 * scale * 8000 * scale).toBeLessThanOrEqual(MAX_CANVAS_PIXELS * 1.0001)
  })
})
