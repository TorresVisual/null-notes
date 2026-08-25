import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
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
