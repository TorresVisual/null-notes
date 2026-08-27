import { describe, it, expect, vi } from 'vitest'
import { drawTextItem } from './textRender'
import type { TextItem } from './types'

function createMockCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    fillText: vi.fn(),
    fillStyle: '',
    font: '',
    textBaseline: '',
  } as unknown as CanvasRenderingContext2D
}

const item: TextItem = { id: 't1', x: 10, y: 20, text: 'hello', color: '#123456', size: 18 }

describe('drawTextItem', () => {
  it('sets fill style, font size and top baseline before drawing', () => {
    const ctx = createMockCtx()
    drawTextItem(ctx, item)
    expect(ctx.fillStyle).toBe('#123456')
    expect(ctx.font).toBe('18px sans-serif')
    expect(ctx.textBaseline).toBe('top')
  })

  it('draws a single line at the item origin', () => {
    const ctx = createMockCtx()
    drawTextItem(ctx, item)
    expect(ctx.fillText).toHaveBeenCalledWith('hello', 10, 20)
    expect(ctx.fillText).toHaveBeenCalledTimes(1)
  })

  it('draws each line of a multi-line item stepped down by the line height', () => {
    const ctx = createMockCtx()
    drawTextItem(ctx, { ...item, text: 'first\nsecond' })
    expect(ctx.fillText).toHaveBeenNthCalledWith(1, 'first', 10, 20)
    expect(ctx.fillText).toHaveBeenNthCalledWith(2, 'second', 10, 20 + 18 * 1.2)
  })
})
