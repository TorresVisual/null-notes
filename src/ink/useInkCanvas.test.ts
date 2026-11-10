import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useInkCanvas, isEraserTip, toInk } from './useInkCanvas'
import { DEFAULT_PENS } from './pens'
import { useInkStore } from '../store/ink'

const CAMERA_OPTIONS = { camera: { x: 0, y: 0, scale: 1 }, viewport: { width: 800, height: 600 } }

vi.mock('../lib/ink', () => ({
  inkApi: {
    read: vi.fn().mockResolvedValue(null),
    write: vi.fn().mockResolvedValue(undefined),
  },
}))

// The store is module-scoped now, unlike the old per-hook useState — a value
// one test leaves behind (a selected pen, a switched tool) would otherwise
// still be there when the next test's fresh renderHook reads it.
beforeEach(() => {
  useInkStore.setState({
    tool: 'pen',
    pens: DEFAULT_PENS,
    activePenId: DEFAULT_PENS[0].id,
    eraserMode: 'point',
    eraserSize: 12,
  })
})

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
    const { result } = renderHook(() => useInkCanvas('/ws/n.ink/s1.svg', CAMERA_OPTIONS))
    await act(async () => {})
    expect(result.current.inkData.strokes).toHaveLength(0)
    expect(result.current.inkData.shapes).toHaveLength(0)
  })

  it('starts with pen tool', () => {
    const { result } = renderHook(() => useInkCanvas('/ws/n.ink/s1.svg', CAMERA_OPTIONS))
    expect(result.current.tool).toBe('pen')
  })

  it('canUndo is false initially', async () => {
    const { result } = renderHook(() => useInkCanvas('/ws/n.ink/s1.svg', CAMERA_OPTIONS))
    await act(async () => {})
    expect(result.current.canUndo).toBe(false)
  })

  it('setTool updates tool', () => {
    const { result } = renderHook(() => useInkCanvas('/ws/n.ink/s1.svg', CAMERA_OPTIONS))
    act(() => result.current.setTool('eraser'))
    expect(result.current.tool).toBe('eraser')
  })
})

describe('eraser size', () => {
  beforeEach(() => localStorage.clear())

  const render = () => renderHook(() => useInkCanvas('/ws/n.ink/s1.svg', CAMERA_OPTIONS))

  // The whole point of Phase 4's second half: a fine nib and a broad eraser.
  it('is independent of the pen size', () => {
    const { result } = render()
    act(() => result.current.setEraserSize(40))
    expect(result.current.eraserSize).toBe(40)
    expect(result.current.size).toBe(DEFAULT_PENS[0].size)
  })

  it('is not disturbed by changing the pen', () => {
    const { result } = render()
    act(() => result.current.setEraserSize(40))
    act(() => result.current.setSize(9))
    expect(result.current.eraserSize).toBe(40)
  })

  it('is remembered for the next note', () => {
    const first = render()
    act(() => first.result.current.setEraserSize(36))
    first.unmount()

    expect(render().result.current.eraserSize).toBe(36)
  })

  it('refuses a size that would make the eraser unusable', () => {
    const { result } = render()
    act(() => result.current.setEraserSize(0))
    expect(result.current.eraserSize).toBe(4)
  })
})

describe('ruler', () => {
  beforeEach(() => localStorage.clear())

  const render = () => renderHook(() => useInkCanvas('/ws/n.ink/s1.svg', CAMERA_OPTIONS))

  it('is out of the way until asked for', () => {
    expect(render().result.current.ruler).toBeNull()
  })

  it('arrives lying across the middle of the page', () => {
    const { result } = render()
    act(() => result.current.toggleRuler())
    expect(result.current.ruler).toMatchObject({ x: 400, y: 300, angle: 0 })
  })

  it('puts it away again', () => {
    const { result } = render()
    act(() => result.current.toggleRuler())
    act(() => result.current.toggleRuler())
    expect(result.current.ruler).toBeNull()
  })

  // It is a working aid, not part of the note — nothing about it is saved.
  it('costs no undo history', () => {
    const { result } = render()
    act(() => result.current.toggleRuler())
    expect(result.current.canUndo).toBe(false)
  })

  // A finger holds the straightedge while the pen draws against it, so the grab
  // has to be callable from the touch handlers, not just the pen ones.
  it('is not grabbable while it is put away', () => {
    const { result } = render()
    expect(result.current.grabRuler(400, 300)).toBe(false)
  })

  it('is grabbed by a touch landing on it', () => {
    const { result } = render()
    act(() => result.current.toggleRuler())
    expect(result.current.grabRuler(400, 300)).toBe(true)
  })

  it('ignores a touch nowhere near it', () => {
    const { result } = render()
    act(() => result.current.toggleRuler())
    expect(result.current.grabRuler(400, 30)).toBe(false)
  })

  it('slides when a finger dragging its middle moves', () => {
    const { result } = render()
    act(() => result.current.toggleRuler())
    act(() => {
      result.current.grabRuler(400, 300)
      result.current.dragRuler(460, 340)
    })
    expect(result.current.ruler).toMatchObject({ x: 460, y: 340, angle: 0 })
  })

  it('swings when a finger dragging an end moves', () => {
    const { result } = render()
    act(() => result.current.toggleRuler())
    act(() => {
      result.current.grabRuler(660, 300)
      result.current.dragRuler(400, 560)
    })
    expect(result.current.ruler?.angle).toBeCloseTo(Math.PI / 2)
    expect(result.current.ruler).toMatchObject({ x: 400, y: 300 })
  })

  it('lets go, so the next drag does not keep moving it', () => {
    const { result } = render()
    act(() => result.current.toggleRuler())
    act(() => {
      result.current.grabRuler(400, 300)
      result.current.releaseRuler()
      result.current.dragRuler(700, 500)
    })
    expect(result.current.ruler).toMatchObject({ x: 400, y: 300 })
  })
})

describe('eraser mode', () => {
  beforeEach(() => localStorage.clear())

  const render = () => renderHook(() => useInkCanvas('/ws/n.ink/s1.svg', CAMERA_OPTIONS))

  // Point is the default: it is the mode that cannot take work you meant to keep.
  it('starts on the point eraser', () => {
    expect(render().result.current.eraserMode).toBe('point')
  })

  it('switches to the stroke eraser', () => {
    const { result } = render()
    act(() => result.current.setEraserMode('stroke'))
    expect(result.current.eraserMode).toBe('stroke')
  })

  it('remembers the choice for the next note', () => {
    const first = render()
    act(() => first.result.current.setEraserMode('stroke'))
    first.unmount()

    expect(render().result.current.eraserMode).toBe('stroke')
  })
})

describe('lasso selection', () => {
  beforeEach(() => localStorage.clear())

  const render = () => renderHook(() => useInkCanvas('/ws/n.ink/s1.svg', CAMERA_OPTIONS))

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

  const render = () => renderHook(() => useInkCanvas('/ws/n.ink/s1.svg', CAMERA_OPTIONS))
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

describe('toInk', () => {
  it('divides the screen offset by scale, then adds the camera position', () => {
    expect(toInk({ clientX: 200, clientY: 100 }, { x: -400, y: -50, scale: 2 }, { left: 0, top: 0 })).toEqual({
      x: -300,
      y: 0,
    })
  })

  it('measures from the canvas edge, not the window edge', () => {
    expect(toInk({ clientX: 190, clientY: 130 }, { x: 0, y: 0, scale: 1.5 }, { left: 100, top: 100 })).toEqual({
      x: 60,
      y: 20,
    })
  })
})
