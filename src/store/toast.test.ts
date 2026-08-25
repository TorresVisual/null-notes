import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { useToastStore, showToast, TOAST_AUTO_DISMISS_MS } from './toast'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  useToastStore.setState({ toasts: [] })
  vi.useRealTimers()
})

describe('toast store', () => {
  it('pushes a toast with the given message', () => {
    showToast('Imported "Lecture 7"')

    const { toasts } = useToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.message).toBe('Imported "Lecture 7"')
  })

  it('assigns each toast a distinct id', () => {
    showToast('First')
    showToast('Second')

    const { toasts } = useToastStore.getState()
    expect(toasts).toHaveLength(2)
    expect(toasts[0]!.id).not.toBe(toasts[1]!.id)
  })

  it('dismiss removes only the matching toast', () => {
    showToast('First')
    showToast('Second')
    const [first, second] = useToastStore.getState().toasts

    useToastStore.getState().dismiss(first!.id)

    const { toasts } = useToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.id).toBe(second!.id)
  })

  it('auto-dismisses after TOAST_AUTO_DISMISS_MS', () => {
    showToast('Fades on its own')
    expect(useToastStore.getState().toasts).toHaveLength(1)

    vi.advanceTimersByTime(TOAST_AUTO_DISMISS_MS)

    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  // A second toast pushed before the first expires must not reset the
  // first's timer — each toast's dismissal is scheduled once, at push time,
  // not recomputed from the current list on every change.
  it('an earlier toast still expires on its own schedule when a later one is pushed', () => {
    showToast('First')
    vi.advanceTimersByTime(TOAST_AUTO_DISMISS_MS / 2)
    showToast('Second')

    vi.advanceTimersByTime(TOAST_AUTO_DISMISS_MS / 2)

    const { toasts } = useToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.message).toBe('Second')
  })
})
