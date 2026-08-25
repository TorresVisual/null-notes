import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useOverlayManager } from './useOverlayManager'

afterEach(() => {
  cleanup()
})

describe('useOverlayManager', () => {
  it('starts with no overlay active', () => {
    const { result } = renderHook(() => useOverlayManager())
    expect(result.current.activeOverlay).toBeNull()
  })

  it('openOverlay sets the active overlay', () => {
    const { result } = renderHook(() => useOverlayManager())
    act(() => result.current.openOverlay('settings'))
    expect(result.current.activeOverlay).toBe('settings')
  })

  it('opening a second overlay replaces the first — one overlay at a time', () => {
    const { result } = renderHook(() => useOverlayManager())
    act(() => result.current.openOverlay('settings'))
    act(() => result.current.openOverlay('shortcuts'))
    expect(result.current.activeOverlay).toBe('shortcuts')
  })

  it('closeOverlay clears the active overlay', () => {
    const { result } = renderHook(() => useOverlayManager())
    act(() => result.current.openOverlay('search'))
    act(() => result.current.closeOverlay())
    expect(result.current.activeOverlay).toBeNull()
  })

  it('Escape closes whichever overlay is active', () => {
    const { result } = renderHook(() => useOverlayManager())
    act(() => result.current.openOverlay('settings'))

    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(result.current.activeOverlay).toBeNull()
  })

  it('Escape with nothing open is a no-op', () => {
    const { result } = renderHook(() => useOverlayManager())

    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(result.current.activeOverlay).toBeNull()
  })
})
