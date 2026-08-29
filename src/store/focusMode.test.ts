import { describe, it, expect, beforeEach } from 'vitest'
import { useFocusModeStore } from './focusMode'

describe('useFocusModeStore', () => {
  beforeEach(() => useFocusModeStore.setState({ enabled: false }))

  it('starts disabled', () => {
    expect(useFocusModeStore.getState().enabled).toBe(false)
  })

  it('toggle flips it on, then off again', () => {
    useFocusModeStore.getState().toggle()
    expect(useFocusModeStore.getState().enabled).toBe(true)

    useFocusModeStore.getState().toggle()
    expect(useFocusModeStore.getState().enabled).toBe(false)
  })
})
