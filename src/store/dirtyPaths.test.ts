import { describe, it, expect, beforeEach } from 'vitest'
import { useDirtyPathsStore } from './dirtyPaths'

describe('useDirtyPathsStore', () => {
  beforeEach(() => useDirtyPathsStore.setState({ paths: new Set() }))

  it('forgets a path once it is marked clean', () => {
    const { markDirty, markClean } = useDirtyPathsStore.getState()
    markDirty('/ws/a.md')
    expect(useDirtyPathsStore.getState().paths.has('/ws/a.md')).toBe(true)
    markClean('/ws/a.md')
    expect(useDirtyPathsStore.getState().paths.size).toBe(0)
  })

  it('does not notify subscribers when nothing changed', () => {
    let notified = 0
    const unsubscribe = useDirtyPathsStore.subscribe(() => notified++)
    const { markDirty, markClean } = useDirtyPathsStore.getState()
    markClean('/ws/a.md')
    markDirty('/ws/a.md')
    markDirty('/ws/a.md')
    unsubscribe()
    expect(notified).toBe(1)
  })
})
