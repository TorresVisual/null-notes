import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useInkCanvas, isEraserTip } from './useInkCanvas'

vi.mock('../lib/ink', () => ({
  inkApi: {
    read: vi.fn().mockResolvedValue(null),
    write: vi.fn().mockResolvedValue(undefined),
  },
}))

// The pen's eraser end reports button 5 only on down and up; mid-drag the
// button field is -1 and the state lives in the buttons bitmask. Missing that
// is why flipping the pen over used to draw instead of erase.
describe('isEraserTip', () => {
  it('detects the eraser end on pointerdown', () => {
    expect(isEraserTip({ button: 5, buttons: 32 })).toBe(true)
  })

  it('detects the eraser end mid-drag, where button is -1', () => {
    expect(isEraserTip({ button: -1, buttons: 32 })).toBe(true)
  })

  it('detects the eraser end on pointerup, where buttons is 0', () => {
    expect(isEraserTip({ button: 5, buttons: 0 })).toBe(true)
  })

  it('leaves the writing tip alone in every phase', () => {
    expect(isEraserTip({ button: 0, buttons: 1 })).toBe(false)
    expect(isEraserTip({ button: -1, buttons: 1 })).toBe(false)
    expect(isEraserTip({ button: 0, buttons: 0 })).toBe(false)
  })

  it('does not mistake the barrel button for the eraser', () => {
    expect(isEraserTip({ button: 2, buttons: 2 })).toBe(false)
  })
})

describe('useInkCanvas', () => {
  it('initialises with empty ink data', async () => {
    const { result } = renderHook(() => useInkCanvas('/ws/n.ink/s1.svg', 800, 600))
    await act(async () => {})
    expect(result.current.inkData.strokes).toHaveLength(0)
    expect(result.current.inkData.shapes).toHaveLength(0)
  })

  it('starts with pen tool', () => {
    const { result } = renderHook(() => useInkCanvas('/ws/n.ink/s1.svg', 800, 600))
    expect(result.current.tool).toBe('pen')
  })

  it('canUndo is false initially', async () => {
    const { result } = renderHook(() => useInkCanvas('/ws/n.ink/s1.svg', 800, 600))
    await act(async () => {})
    expect(result.current.canUndo).toBe(false)
  })

  it('setTool updates tool', () => {
    const { result } = renderHook(() => useInkCanvas('/ws/n.ink/s1.svg', 800, 600))
    act(() => result.current.setTool('eraser'))
    expect(result.current.tool).toBe('eraser')
  })
})
