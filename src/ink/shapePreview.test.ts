import { describe, it, expect, vi } from 'vitest'
import { drawShapePreview } from './shapePreview'

function createMockCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    rect: vi.fn(),
    ellipse: vi.fn(),
    stroke: vi.fn(),
    strokeStyle: '',
    lineWidth: 0,
  } as unknown as CanvasRenderingContext2D
}

describe('drawShapePreview', () => {
  it('draws a line with moveTo/lineTo and strokes it', () => {
    const ctx = createMockCtx()
    drawShapePreview(ctx, { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 10, color: '#000', size: 2 })
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 0)
    expect(ctx.lineTo).toHaveBeenCalledWith(10, 10)
    expect(ctx.stroke).toHaveBeenCalled()
  })

  it('draws a rect via ctx.rect with normalized bounds', () => {
    const ctx = createMockCtx()
    drawShapePreview(ctx, { kind: 'rect', x1: 10, y1: 10, x2: 0, y2: 0, color: '#000', size: 2 })
    expect(ctx.rect).toHaveBeenCalledWith(0, 0, 10, 10)
  })

  it('draws a circle via ctx.ellipse', () => {
    const ctx = createMockCtx()
    drawShapePreview(ctx, { kind: 'circle', x1: 0, y1: 0, x2: 10, y2: 10, color: '#000', size: 2 })
    expect(ctx.ellipse).toHaveBeenCalledWith(5, 5, 5, 5, 0, 0, Math.PI * 2)
  })

  it('draws an arrow as a line plus two head segments', () => {
    const ctx = createMockCtx()
    drawShapePreview(ctx, { kind: 'arrow', x1: 0, y1: 0, x2: 10, y2: 0, color: '#000', size: 2 })
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 0)
    expect(ctx.lineTo).toHaveBeenCalledWith(10, 0)
    expect(ctx.moveTo).toHaveBeenCalledTimes(3)
    expect(ctx.lineTo).toHaveBeenCalledTimes(3)
  })
})
