import { describe, it, expect } from 'vitest'
import { DEFAULT_LINE_CONFIG, recognizeLine } from './lineRecognition'
import type { Point } from '../types'

function pt(x: number, y: number): Point {
  return { x, y, pressure: 0.5 }
}

// Deterministic stand-in for hand tremor, in [-1, 1]. A function of position
// along the stroke, not of sample index, so a faster digitiser sees the same
// hand, not different noise.
function wobble(t: number): number {
  return Math.sin(t * 17) * 0.6 + Math.sin(t * 37) * 0.4
}

function line(x1: number, y1: number, x2: number, y2: number, samples: number, shake = 0): Point[] {
  const length = Math.hypot(x2 - x1, y2 - y1)
  const nx = -(y2 - y1) / length
  const ny = (x2 - x1) / length
  return Array.from({ length: samples }, (_, i) => {
    const t = i / (samples - 1)
    const off = i === 0 || i === samples - 1 ? 0 : wobble(t) * shake
    return pt(x1 + (x2 - x1) * t + nx * off, y1 + (y2 - y1) * t + ny * off)
  })
}

// One full sine cycle along a horizontal chord of length 400. The fitted line
// tilts to follow it, so amplitude 24 lands at RMS ≈ 2.7% of the chord: past
// the enter limit (2.5%) and inside the exit limit (4%).
function sine(amplitude: number): Point[] {
  return Array.from({ length: 120 }, (_, i) => {
    const t = i / 119
    return pt(t * 400, amplitude * Math.sin(t * 2 * Math.PI))
  })
}

describe('recognizeLine — straight strokes', () => {
  it('recognises horizontal, vertical and diagonal lines with their own endpoints', () => {
    for (const [x1, y1, x2, y2] of [
      [10, 50, 310, 50],
      [40, 10, 40, 260],
      [20, 20, 220, 170],
    ] as const) {
      const found = recognizeLine(line(x1, y1, x2, y2, 60))
      expect(found).not.toBeNull()
      expect(found?.x1).toBeCloseTo(x1, 6)
      expect(found?.y1).toBeCloseTo(y1, 6)
      expect(found?.x2).toBeCloseTo(x2, 6)
      expect(found?.y2).toBeCloseTo(y2, 6)
    }
  })

  it('keeps the drawing direction: the line starts where the pen touched down', () => {
    const found = recognizeLine(line(300, 40, 20, 60, 60))
    expect(found?.x1).toBeCloseTo(300, 6)
    expect(found?.x2).toBeCloseTo(20, 6)
  })

  it('accepts a slightly shaky line and lands its ends on the fitted line, not on the shake', () => {
    const points = line(0, 0, 300, 0, 80, 3)
    const found = recognizeLine(points)
    expect(found).not.toBeNull()
    expect(Math.abs(found?.y1 ?? 99)).toBeLessThan(3)
    expect(Math.abs(found?.y2 ?? 99)).toBeLessThan(3)
  })

  it('accepts shaky vertical and diagonal lines too', () => {
    expect(recognizeLine(line(40, 10, 40, 260, 80, 3))).not.toBeNull()
    expect(recognizeLine(line(20, 20, 220, 170, 80, 3))).not.toBeNull()
  })

  it('is not flipped by one isolated noisy sample', () => {
    const points = line(0, 0, 300, 0, 100)
    points[50] = pt(points[50]!.x, 6)
    expect(recognizeLine(points)).not.toBeNull()
  })

  it('ignores duplicate samples and sub-threshold jitter', () => {
    const base = line(0, 0, 300, 0, 40)
    const points = base.flatMap((p) => [p, p, pt(p.x + 0.05, p.y)])
    expect(recognizeLine(points)).not.toBeNull()
  })

  it('gives the same verdict across sample densities', () => {
    for (const samples of [4, 12, 60, 600]) {
      expect(recognizeLine(line(0, 0, 300, 20, samples, 2)), `${samples} samples`).not.toBeNull()
    }
  })

  it('does not modify the stroke it was given', () => {
    const points = line(0, 0, 300, 4, 50, 2)
    const before = JSON.stringify(points)
    recognizeLine(points)
    expect(JSON.stringify(points)).toBe(before)
  })
})

describe('recognizeLine — strokes that stay freehand', () => {
  it('rejects a bowed curve', () => {
    const arc = Array.from({ length: 60 }, (_, i) => {
      const t = i / 59
      return pt(t * 300, 45 * Math.sin(t * Math.PI))
    })
    expect(recognizeLine(arc)).toBeNull()
  })

  it('rejects a zigzag whose ends are in line', () => {
    const zig = Array.from({ length: 41 }, (_, i) => pt(i * 8, i % 2 === 0 ? 0 : 30))
    expect(recognizeLine(zig)).toBeNull()
  })

  it('rejects a V and a closed loop', () => {
    expect(recognizeLine([pt(10, 10), pt(60, 80), pt(110, 10)])).toBeNull()
    expect(recognizeLine([pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100), pt(0, 1)])).toBeNull()
  })

  it('rejects a stroke too short to be a deliberate line, and one with too few samples', () => {
    expect(recognizeLine(line(0, 0, 8, 0, 20))).toBeNull()
    expect(recognizeLine([pt(0, 0), pt(300, 0)])).toBeNull()
    expect(recognizeLine([pt(5, 5), pt(5, 5), pt(5, 5)])).toBeNull()
    expect(recognizeLine([])).toBeNull()
  })
})

describe('recognizeLine — hysteresis', () => {
  // The p95 and chord/path gates would reject these strokes on their own, so
  // they are opened up to isolate the RMS rule.
  const rmsOnly = { ...DEFAULT_LINE_CONFIG, maxP95: 1, minChordPathRatio: 0.9 }

  it('needs RMS <= 2.5% to start, but holds on until RMS reaches 4%', () => {
    const between = sine(24)
    expect(recognizeLine(between, false, rmsOnly)).toBeNull()
    expect(recognizeLine(between, true, rmsOnly)).not.toBeNull()
  })

  it('lets go of the line once RMS passes 4%, however it started', () => {
    const past = sine(40)
    expect(recognizeLine(past, true, rmsOnly)).toBeNull()
    expect(recognizeLine(past, false, rmsOnly)).toBeNull()
  })

  it('does not flicker: a stroke settling at RMS ≈ 2.7% stays a line once shown', () => {
    const showing = recognizeLine(sine(10), false) !== null
    expect(showing).toBe(true)
    const frames = [10, 24, 24, 20, 24].map((a) => recognizeLine(sine(a), true, rmsOnly) !== null)
    expect(frames).toEqual([true, true, true, true, true])
  })

  it('still enforces the other conditions while holding', () => {
    const zig = Array.from({ length: 41 }, (_, i) => pt(i * 8, i % 2 === 0 ? 0 : 6))
    expect(recognizeLine(zig, true)).toBeNull()
  })
})
