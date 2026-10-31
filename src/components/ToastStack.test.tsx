import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import { ToastStack } from './ToastStack'
import { useToastStore, showToast } from '../store/toast'

afterEach(() => {
  cleanup()
  useToastStore.setState({ toasts: [] })
})

describe('ToastStack', () => {
  it('renders nothing when there are no toasts', () => {
    const { container } = render(<ToastStack />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a pushed toast', () => {
    render(<ToastStack />)
    act(() => showToast('Imported "Lecture 7"'))

    expect(screen.getByText('Imported "Lecture 7"')).toBeInTheDocument()
  })

  it('renders multiple toasts in push order', () => {
    render(<ToastStack />)
    act(() => {
      showToast('First')
      showToast('Second')
    })

    const items = screen.getAllByRole('status')
    expect(items.map((el) => el.textContent)).toEqual(['First', 'Second'])
  })
})

describe('ToastStack action', () => {
  it('runs the action and dismisses the toast when its button is clicked', () => {
    const onClick = vi.fn()
    render(<ToastStack />)
    act(() => showToast('Deleted "Lecture 7"', { label: 'Undo', onClick }))

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })
})
