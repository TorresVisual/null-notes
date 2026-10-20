import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { PenGallery } from './PenGallery'
import { useInkStore, activePenOf } from '../store/ink'
import { DEFAULT_PENS } from './pens'
import type { Pen } from './types'

function reset(pens: Pen[] = DEFAULT_PENS, tool: 'pen' | 'eraser' = 'pen') {
  useInkStore.setState({ tool, pens, activePenId: pens[0]?.id ?? '' })
}

beforeEach(() => reset())
afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('PenGallery', () => {
  it('shows one card per preset', () => {
    render(<PenGallery />)

    for (const pen of DEFAULT_PENS) expect(screen.getByRole('button', { name: pen.label })).toBeInTheDocument()
  })

  it('draws each sample in its own colour and opacity', () => {
    render(<PenGallery />)

    const path = screen.getByRole('button', { name: 'Yellow highlighter' }).querySelector('path')
    expect(path?.getAttribute('stroke')).toBe('#e3b341')
    expect(path?.getAttribute('stroke-opacity')).toBe('0.3')
  })

  it('selects a pen on the first click without opening a flyout', () => {
    render(<PenGallery />)

    fireEvent.click(screen.getByRole('button', { name: 'Red' }))

    expect(useInkStore.getState().activePenId).toBe('red')
    expect(screen.queryByLabelText('Pen thickness')).toBeNull()
  })

  it('only switches back to the pen when another tool is active', () => {
    reset(DEFAULT_PENS, 'eraser')
    render(<PenGallery />)

    fireEvent.click(screen.getByRole('button', { name: 'Fine' }))

    expect(useInkStore.getState().tool).toBe('pen')
    expect(screen.queryByLabelText('Pen thickness')).toBeNull()
  })

  it('opens the flyout when the active pen is clicked again', () => {
    render(<PenGallery />)

    fireEvent.click(screen.getByRole('button', { name: 'Fine' }))

    expect(screen.getByLabelText('Pen thickness')).toBeInTheDocument()
  })

  it('edits the active pen from the flyout', () => {
    render(<PenGallery />)
    fireEvent.click(screen.getByRole('button', { name: 'Fine' }))

    fireEvent.change(screen.getByLabelText('Pen thickness'), { target: { value: '8' } })
    expect(activePenOf(useInkStore.getState()).size).toBe(8)

    fireEvent.click(screen.getByRole('button', { name: '#ff7b72' }))
    expect(activePenOf(useInkStore.getState()).color).toBe('#ff7b72')

    fireEvent.change(screen.getByLabelText('Custom color'), { target: { value: '#123456' } })
    expect(activePenOf(useInkStore.getState()).color).toBe('#123456')
  })

  it('leaves opacity alone when editing', () => {
    reset([{ id: 'hl', label: 'Highlighter', color: '#e3b341', size: 20, opacity: 0.3 }])
    render(<PenGallery />)
    fireEvent.click(screen.getByRole('button', { name: 'Highlighter' }))

    fireEvent.click(screen.getByRole('button', { name: '#ff7b72' }))

    expect(activePenOf(useInkStore.getState()).opacity).toBe(0.3)
  })

  // Hand-edited storage can hold any string; the colour input would otherwise
  // be the only thing standing between that and a crash.
  it('renders a pen whose colour is not #rrggbb and marks no swatch selected', () => {
    reset([{ id: 'odd', label: 'Odd', color: 'tomato', size: 2, opacity: 1 }])
    render(<PenGallery />)

    fireEvent.click(screen.getByRole('button', { name: 'Odd' }))

    expect(screen.getByLabelText('Pen thickness')).toBeInTheDocument()
    expect(screen.queryAllByRole('button', { pressed: true, name: /^#/ })).toHaveLength(0)
  })
})
