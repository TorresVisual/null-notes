import { describe, expect, it } from 'vitest'
import { compileExpression, parsePlotSource, samplePlot, yBounds } from './plot'

describe('compileExpression', () => {
  it.each([
    ['x^2', 3, 9],
    ['-x^2', 3, -9],
    ['2^3^2', 0, 512],
    ['2x + 1', 4, 9],
    ['n log n', Math.E, Math.E],
    ['x^2 * ln(x)', 1, 0],
    ['sqrt(x)/2', 16, 2],
    ['sin(pi/2)', 0, 1],
    ['log2 x', 8, 3],
  ])('%s at %d = %d', (expr, x, expected) => {
    expect(compileExpression(expr)(x)).toBeCloseTo(expected)
  })

  it.each(['x +', '(x', 'foo(x)', '2 $ x', ''])('rejects %j', (expr) => {
    expect(() => compileExpression(expr)).toThrow()
  })
})

describe('parsePlotSource', () => {
  it('splits expressions from the range line and strips y=', () => {
    expect(parsePlotSource('y = x^2\nn log n\nx: 1..50')).toEqual({
      exprs: ['x^2', 'n log n'],
      xMin: 1,
      xMax: 50,
    })
  })

  it('falls back to the default range', () => {
    expect(parsePlotSource('x')).toMatchObject({ xMin: -10, xMax: 10 })
  })
})

describe('samplePlot', () => {
  it('drops non-finite points and flags unparseable expressions', () => {
    const [good, bad] = samplePlot({ exprs: ['log(x)', 'x +'], xMin: -1, xMax: 1 })
    expect(good?.points.some((p) => p === null)).toBe(true)
    expect(bad?.error).toBe(true)
  })

  it('bounds y by the data', () => {
    const [lo, hi] = yBounds(samplePlot({ exprs: ['x'], xMin: 0, xMax: 10 }))
    expect(lo).toBeLessThan(0.5)
    expect(hi).toBeGreaterThan(9.5)
  })
})
