import { describe, it, expect } from 'vitest'
import { isCanvasPath } from './canvasPath'

describe('isCanvasPath', () => {
  it('matches only a trailing .canvas', () => {
    expect(isCanvasPath('a/b.canvas')).toBe(true)
    expect(isCanvasPath('C:\ws\b.canvas')).toBe(true)
    expect(isCanvasPath('a/b.canvas.md')).toBe(false)
    expect(isCanvasPath('a/b.md')).toBe(false)
  })
})
