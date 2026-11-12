import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { TouchEvent } from 'react'
import { useEdgeSwipe } from './useEdgeSwipe'

const WIDTH = 400

function touch(x: number, y: number) {
  return { touches: [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }] } as unknown as TouchEvent<HTMLElement>
}

function swipe(fromX: number, toX: number, dy = 0, enabled = true) {
  Object.defineProperty(window, 'innerWidth', { value: WIDTH, configurable: true })
  const onSwipe = vi.fn()
  const { result } = renderHook(() => useEdgeSwipe(onSwipe, enabled))
  result.current.onTouchStart?.(touch(fromX, 100))
  result.current.onTouchEnd?.(touch(toX, 100 + dy))
  return onSwipe
}

describe('useEdgeSwipe', () => {
  it('fires on a leftward drag from the right edge', () => {
    expect(swipe(WIDTH - 5, WIDTH - 120)).toHaveBeenCalledOnce()
  })

  it('ignores drags that start away from the edge', () => {
    expect(swipe(WIDTH - 100, WIDTH - 220)).not.toHaveBeenCalled()
  })

  it('ignores the left edge, which belongs to system back', () => {
    expect(swipe(5, 120)).not.toHaveBeenCalled()
  })

  it('ignores short or mostly vertical drags', () => {
    expect(swipe(WIDTH - 5, WIDTH - 30)).not.toHaveBeenCalled()
    expect(swipe(WIDTH - 5, WIDTH - 80, 200)).not.toHaveBeenCalled()
  })

  it('attaches no handlers when disabled', () => {
    expect(swipe(WIDTH - 5, WIDTH - 120, 0, false)).not.toHaveBeenCalled()
  })
})
