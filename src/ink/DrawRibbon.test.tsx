import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { DrawRibbon } from './DrawRibbon'
import { useInkStore } from '../store/ink'
import type { CanvasHandle } from '../store/ink'
import { DEFAULT_PENS } from './pens'
import type { Tool } from './types'

function handle(overrides: Partial<CanvasHandle> = {}): CanvasHandle {
  return {
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: true,
    canRedo: true,
    deleteSelected: vi.fn(),
    hasSelection: false,
    toggleRuler: vi.fn(),
    rulerOn: false,
    zoom: 1,
    setZoom: vi.fn(),
    ...overrides,
  }
}

function setup(tool: Tool = 'pen', canvas: CanvasHandle | null = handle()) {
  useInkStore.setState({
    tool,
    pens: DEFAULT_PENS,
    activePenId: DEFAULT_PENS[0].id,
    eraserMode: 'point',
    eraserSize: 12,
    textSize: 18,
    activeCanvas: canvas,
    activeCanvasId: canvas ? 'c' : null,
  })
  const onDone = vi.fn()
  render(<DrawRibbon onDone={onDone} />)
  return { onDone, canvas }
}

const tool = () => useInkStore.getState().tool

afterEach(() => {
  cleanup()
  localStorage.clear()
})
beforeEach(() => localStorage.clear())

describe('DrawRibbon tools', () => {
  it('selects lasso on click', () => {
    setup()

    fireEvent.click(screen.getByRole('button', { name: 'Lasso select' }))

    expect(tool()).toBe('lasso')
  })

  it('activates the eraser first, then opens its flyout on the second click', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Eraser' }))
    expect(tool()).toBe('eraser')
    expect(screen.queryByLabelText('Eraser size')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Eraser' }))

    expect(screen.getByLabelText('Eraser size')).toBeInTheDocument()
  })

  it('changes eraser mode and size from the flyout', () => {
    setup('eraser')
    fireEvent.click(screen.getByRole('button', { name: 'Eraser' }))

    fireEvent.click(screen.getByRole('button', { name: /Stroke eraser/ }))
    fireEvent.change(screen.getByLabelText('Eraser size'), { target: { value: '40' } })

    expect(useInkStore.getState().eraserMode).toBe('stroke')
    expect(useInkStore.getState().eraserSize).toBe(40)
  })

  it('sets text size from the text flyout', () => {
    setup('text')
    fireEvent.click(screen.getByRole('button', { name: 'Text' }))

    fireEvent.change(screen.getByLabelText('Text size'), { target: { value: '30' } })

    expect(useInkStore.getState().textSize).toBe(30)
  })

  it('toggles the ruler', () => {
    const { canvas } = setup()

    fireEvent.click(screen.getByRole('button', { name: 'Ruler' }))

    expect(canvas?.toggleRuler).toHaveBeenCalledTimes(1)
  })

  it('shows Delete only while something is selected', () => {
    cleanup()
    setup('lasso', handle({ hasSelection: false }))
    expect(screen.queryByRole('button', { name: 'Delete selection' })).toBeNull()
    cleanup()

    const { canvas } = setup('lasso', handle({ hasSelection: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete selection' }))

    expect(canvas?.deleteSelected).toHaveBeenCalledTimes(1)
  })
})

describe('DrawRibbon shapes', () => {
  it('starts on line, then remembers the last choice', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Shapes' }))
    expect(tool()).toBe('line')

    fireEvent.click(screen.getByRole('button', { name: 'Shapes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Circle' }))
    expect(tool()).toBe('circle')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Circle' })).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Lasso select' }))
    fireEvent.click(screen.getByRole('button', { name: 'Shapes' }))

    expect(tool()).toBe('circle')
  })

  it('reads as active for any shape tool, including one set from outside the ribbon', () => {
    setup('arrow')

    const button = screen.getByRole('button', { name: 'Shapes' })

    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button).toHaveAttribute('title', expect.stringContaining('Arrow'))
  })

  it('is not active for a non-shape tool', () => {
    setup('pen')

    expect(screen.getByRole('button', { name: 'Shapes' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('DrawRibbon right side', () => {
  it('undoes, redoes and finishes', () => {
    const { canvas, onDone } = setup()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(canvas?.undo).toHaveBeenCalledTimes(1)
    expect(canvas?.redo).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('shows the current zoom and sets a new one from the flyout', () => {
    const { canvas } = setup('pen', handle({ zoom: 1 }))
    expect(screen.getByRole('button', { name: 'Zoom' })).toHaveTextContent('100%')

    fireEvent.click(screen.getByRole('button', { name: 'Zoom' }))
    fireEvent.click(screen.getByRole('button', { name: '150%' }))

    expect(canvas?.setZoom).toHaveBeenCalledWith(1.5)
  })

  it('has no fit-width control', () => {
    setup()

    expect(screen.queryByRole('button', { name: /fit/i })).toBeNull()
  })

  // The overlay registers its canvas on mount, but the ribbon renders first,
  // and another canvas can take the slot.
  it('renders with no registered canvas, with undo and redo disabled', () => {
    const { onDone } = setup('pen', null)

    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Zoom' })).toHaveTextContent('100%')
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})
