import { describe, it, expect, beforeEach } from 'vitest'
import { useMobileEditStore } from './mobileEdit'

describe('useMobileEditStore', () => {
  beforeEach(() => useMobileEditStore.setState({ editingPath: null }))

  it('startEditing sets the path and replaces a previous one', () => {
    useMobileEditStore.getState().startEditing('a.md')
    expect(useMobileEditStore.getState().editingPath).toBe('a.md')

    useMobileEditStore.getState().startEditing('b.md')
    expect(useMobileEditStore.getState().editingPath).toBe('b.md')
  })

  it('stopEditing returns to null', () => {
    useMobileEditStore.getState().startEditing('a.md')
    useMobileEditStore.getState().stopEditing()
    expect(useMobileEditStore.getState().editingPath).toBeNull()
  })
})
