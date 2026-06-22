import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useInkCanvas } from './useInkCanvas'

vi.mock('../lib/ink', () => ({
  inkApi: {
    read: vi.fn().mockResolvedValue(null),
    write: vi.fn().mockResolvedValue(undefined),
  },
}))

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
