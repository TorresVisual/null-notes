import { describe, it, expect, vi } from 'vitest'
import { flushAllCanvases, registerCanvasFlush } from './canvasFlush'

describe('flushAllCanvases', () => {
  it('waits for every registered canvas to finish saving', async () => {
    const order: string[] = []
    const slow = vi.fn(async () => {
      await Promise.resolve()
      order.push('slow')
    })
    const fast = vi.fn(async () => {
      order.push('fast')
    })
    const offSlow = registerCanvasFlush(slow)
    const offFast = registerCanvasFlush(fast)

    await flushAllCanvases()

    expect(order.sort()).toEqual(['fast', 'slow'])
    offSlow()
    offFast()
  })

  it('stops calling a canvas once it is unregistered', async () => {
    const flush = vi.fn(async () => {})
    registerCanvasFlush(flush)()

    await flushAllCanvases()

    expect(flush).not.toHaveBeenCalled()
  })

  it('still resolves when one canvas fails to save', async () => {
    const ok = vi.fn(async () => {})
    const off = [registerCanvasFlush(async () => Promise.reject(new Error('disk full'))), registerCanvasFlush(ok)]

    await expect(flushAllCanvases()).resolves.toBeUndefined()
    expect(ok).toHaveBeenCalled()
    off.forEach((f) => f())
  })
})
