import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { KeymapSettings } from './KeymapSettings'

afterEach(cleanup)

function record(label: string, init: KeyboardEventInit) {
  fireEvent.click(screen.getByLabelText(`Change shortcut for ${label}`))
  fireEvent.keyDown(screen.getByText('Press keys…'), init)
}

describe('KeymapSettings', () => {
  it('stores a recorded combo as an override', () => {
    const onChange = vi.fn()
    render(<KeymapSettings overrides={{}} onChange={onChange} />)
    record('Search', { key: 'j', ctrlKey: true, altKey: true })
    expect(onChange).toHaveBeenCalledWith({ search: 'Ctrl+Alt+J' })
  })

  it('blocks a combo another command owns and says which', () => {
    const onChange = vi.fn()
    render(<KeymapSettings overrides={{}} onChange={onChange} />)
    record('Search', { key: 'p', ctrlKey: true })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText(/Already used by .*Quick Switcher/)).toBeInTheDocument()
  })

  it('clears, resets one, and resets all', () => {
    const onChange = vi.fn()
    render(<KeymapSettings overrides={{ search: 'Ctrl+Alt+J' }} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Clear shortcut for Search'))
    expect(onChange).toHaveBeenLastCalledWith({ search: '' })
    fireEvent.click(screen.getByLabelText('Reset shortcut for Search'))
    expect(onChange).toHaveBeenLastCalledWith({})
    fireEvent.click(screen.getByText('Reset all shortcuts'))
    expect(onChange).toHaveBeenLastCalledWith({})
  })

  it('filters by label or key', () => {
    render(<KeymapSettings overrides={{}} onChange={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Search shortcuts'), { target: { value: 'ctrl+shift+p' } })
    expect(screen.getByText('Command Palette')).toBeInTheDocument()
    expect(screen.queryByText('New Note')).not.toBeInTheDocument()
  })
})
