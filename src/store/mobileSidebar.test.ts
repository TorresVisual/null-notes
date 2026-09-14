import { describe, it, expect, beforeEach } from 'vitest'
import { useMobileSidebarStore } from './mobileSidebar'

describe('useMobileSidebarStore', () => {
  beforeEach(() => {
    useMobileSidebarStore.setState({ open: false })
  })

  it('starts closed', () => {
    expect(useMobileSidebarStore.getState().open).toBe(false)
  })

  it('toggle flips open state', () => {
    useMobileSidebarStore.getState().toggle()
    expect(useMobileSidebarStore.getState().open).toBe(true)
    useMobileSidebarStore.getState().toggle()
    expect(useMobileSidebarStore.getState().open).toBe(false)
  })

  it('close sets open false', () => {
    useMobileSidebarStore.setState({ open: true })
    useMobileSidebarStore.getState().close()
    expect(useMobileSidebarStore.getState().open).toBe(false)
  })
})
