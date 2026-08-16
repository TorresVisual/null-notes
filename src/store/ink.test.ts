import { describe, it, expect, beforeEach } from 'vitest'
import { useInkStore, activePenOf } from './ink'
import { DEFAULT_PENS } from '../ink/pens'

function reset() {
  localStorage.clear()
  useInkStore.setState({
    tool: 'pen',
    pens: DEFAULT_PENS,
    activePenId: DEFAULT_PENS[0].id,
    eraserMode: 'point',
    eraserSize: 12,
  })
}

describe('the ink store', () => {
  beforeEach(reset)

  it('starts with the pen tool and the first preset', () => {
    const state = useInkStore.getState()
    expect(state.tool).toBe('pen')
    expect(activePenOf(state).id).toBe(DEFAULT_PENS[0].id)
  })

  it('changes the tool', () => {
    useInkStore.getState().setTool('eraser')
    expect(useInkStore.getState().tool).toBe('eraser')
  })

  // Picking a pen is also picking up the pen: you reach for a colour in order
  // to draw with it, never to erase with it.
  it('selecting a pen switches back to the pen tool', () => {
    useInkStore.getState().setTool('eraser')
    useInkStore.getState().selectPen(DEFAULT_PENS[1]!.id)

    expect(useInkStore.getState().activePenId).toBe(DEFAULT_PENS[1]!.id)
    expect(useInkStore.getState().tool).toBe('pen')
  })

  it('persists the selected pen', () => {
    useInkStore.getState().selectPen(DEFAULT_PENS[1]!.id)
    expect(localStorage.getItem('null-notes.ink.activePen')).toBe(DEFAULT_PENS[1]!.id)
  })

  // Colour and size are not separate state: the selected preset *is* the pen,
  // and editing either edits that preset in place, which is what makes a pen
  // you configured still be there in tomorrow's lecture.
  it('editing colour edits the active pen and persists it', () => {
    useInkStore.getState().updateActivePen({ color: '#ff0000' })

    expect(activePenOf(useInkStore.getState()).color).toBe('#ff0000')
    expect(localStorage.getItem('null-notes.ink.pens')).toContain('#ff0000')
  })

  it('editing size edits the active pen', () => {
    useInkStore.getState().updateActivePen({ size: 9 })
    expect(activePenOf(useInkStore.getState()).size).toBe(9)
  })

  it('leaves the other pens alone when one is edited', () => {
    const before = useInkStore.getState().pens[1]!.color
    useInkStore.getState().updateActivePen({ color: '#00ff00' })

    expect(useInkStore.getState().pens[1]!.color).toBe(before)
  })

  it('persists the eraser mode', () => {
    useInkStore.getState().setEraserMode('stroke')

    expect(useInkStore.getState().eraserMode).toBe('stroke')
    expect(localStorage.getItem('null-notes.ink.eraserMode')).toBe('stroke')
  })

  it('clamps and persists the eraser size', () => {
    useInkStore.getState().setEraserSize(9999)

    const clamped = useInkStore.getState().eraserSize
    expect(clamped).toBeLessThan(9999)
    expect(localStorage.getItem('null-notes.ink.eraserSize')).toBe(String(clamped))
  })
})
