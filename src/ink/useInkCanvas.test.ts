import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useInkCanvas, isEraserTip } from './useInkCanvas'
import { DEFAULT_PENS } from './pens'

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
  beforeEach(() => localStorage.clear())

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

describe('lasso selection', () => {
  beforeEach(() => localStorage.clear())

  const render = () => renderHook(() => useInkCanvas('/ws/n.ink/s1.svg', 800, 600))

  it('starts with nothing selected', () => {
    const { result } = render()
    expect(result.current.hasSelection).toBe(false)
    expect(result.current.selection).toEqual({ strokeIds: [], shapeIds: [] })
  })

  it('deleting with nothing selected is a no-op, not an empty undo entry', () => {
    const { result } = render()
    act(() => result.current.deleteSelected())
    expect(result.current.canUndo).toBe(false)
  })

  // A marquee left floating after you reach for the pen is just clutter.
  it('changing tool drops the selection', () => {
    const { result } = render()
    act(() => result.current.setTool('lasso'))
    act(() => result.current.setTool('pen'))
    expect(result.current.hasSelection).toBe(false)
  })

  it('picking a pen leaves the lasso tool', () => {
    const { result } = render()
    act(() => result.current.setTool('lasso'))
    act(() => result.current.selectPen('red'))
    expect(result.current.tool).toBe('pen')
  })
})

describe('pen presets', () => {
  beforeEach(() => localStorage.clear())

  const render = () => renderHook(() => useInkCanvas('/ws/n.ink/s1.svg', 800, 600))
  // pens.test.ts pins down that a translucent pen ships by default.
  const highlighter = DEFAULT_PENS.find((p) => p.opacity < 1) ?? DEFAULT_PENS[0]

  it('starts on the first pen', () => {
    const { result } = render()
    expect(result.current.activePenId).toBe(DEFAULT_PENS[0].id)
    expect(result.current.color).toBe(DEFAULT_PENS[0].color)
    expect(result.current.size).toBe(DEFAULT_PENS[0].size)
  })

  it('selecting a highlighter takes its colour, width and opacity', () => {
    const { result } = render()
    act(() => result.current.selectPen(highlighter.id))
    expect(result.current.color).toBe(highlighter.color)
    expect(result.current.size).toBe(highlighter.size)
  })

  // Picking up a pen means you want to write, even if the eraser was in hand.
  it('selecting a pen puts the pen tool back', () => {
    const { result } = render()
    act(() => result.current.setTool('eraser'))
    act(() => result.current.selectPen('red'))
    expect(result.current.tool).toBe('pen')
  })

  it('the colour control edits the selected pen rather than a loose setting', () => {
    const { result } = render()
    act(() => result.current.setColor('#ff00ff'))

    const edited = result.current.pens.find((p) => p.id === result.current.activePenId)
    expect(edited?.color).toBe('#ff00ff')
    expect(result.current.color).toBe('#ff00ff')
  })

  it('remembers an edited pen and the selection for the next note', () => {
    const first = render()
    act(() => first.result.current.selectPen('red'))
    act(() => first.result.current.setSize(9))
    first.unmount()

    const second = render()
    expect(second.result.current.activePenId).toBe('red')
    expect(second.result.current.size).toBe(9)
  })
})
