import { describe, it, expect } from 'vitest'
import { toPersistedAppState, sanitizePersistedAppState } from './diagramAppState'
import type { AppState } from '@excalidraw/excalidraw/types'

describe('toPersistedAppState', () => {
  it('keeps only viewBackgroundColor and gridSize, dropping everything else', () => {
    const liveAppState = {
      viewBackgroundColor: '#abcdef',
      gridSize: 20,
      collaborators: new Map([['user-1', { username: 'a' }]]),
      zoom: { value: 1.5 },
      scrollX: 42,
      scrollY: 7,
    } as unknown as AppState

    const persisted = toPersistedAppState(liveAppState)

    expect(persisted).toEqual({ viewBackgroundColor: '#abcdef', gridSize: 20 })
    // The regression this guards: a Map round-tripped through
    // JSON.stringify/JSON.parse degrades into a plain, non-Map object that
    // crashes Excalidraw's own internal ".forEach()" call on it.
    expect(persisted).not.toHaveProperty('collaborators')

    const roundTripped = JSON.parse(JSON.stringify(persisted)) as Record<string, unknown>
    expect(roundTripped).toEqual({ viewBackgroundColor: '#abcdef', gridSize: 20 })
  })
})

describe('sanitizePersistedAppState', () => {
  it('strips stray fields from a file saved before toPersistedAppState existed', () => {
    // Exactly the shape a diagram saved by the pre-fix code left on disk —
    // collaborators degraded from a live Map into this plain object by
    // JSON.stringify, which is what crashed a fresh <Excalidraw
    // initialData> mount on reopen.
    const legacyOnDiskAppState = {
      viewBackgroundColor: '#ffffff',
      gridSize: null,
      collaborators: {},
      zoom: { value: 1 },
      scrollX: 0,
      scrollY: 0,
    }

    expect(sanitizePersistedAppState(legacyOnDiskAppState)).toEqual({
      viewBackgroundColor: '#ffffff',
      gridSize: null,
    })
  })

  it('returns an empty object for missing or malformed input', () => {
    expect(sanitizePersistedAppState(undefined)).toEqual({})
    expect(sanitizePersistedAppState(null)).toEqual({})
    expect(sanitizePersistedAppState('not an object')).toEqual({})
    expect(sanitizePersistedAppState({ viewBackgroundColor: 42 })).toEqual({})
  })
})
