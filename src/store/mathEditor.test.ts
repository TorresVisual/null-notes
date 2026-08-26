import { describe, it, expect, beforeEach } from 'vitest'
import { useMathEditorStore } from './mathEditor'
import type { MathEditorHandle } from './mathEditor'

function handle(overrides: Partial<MathEditorHandle> = {}): MathEditorHandle {
  return {
    insertSymbol: () => {},
    commitAndClose: () => {},
    ...overrides,
  }
}

describe('the active math editor', () => {
  beforeEach(() => useMathEditorStore.setState({ activeEditor: null, activeEditorId: null }))

  it('has none to begin with', () => {
    expect(useMathEditorStore.getState().activeEditor).toBeNull()
    expect(useMathEditorStore.getState().activeEditorId).toBeNull()
  })

  it('remembers the editor that registered', () => {
    let inserted = ''
    useMathEditorStore.getState().setActiveEditor('a', handle({ insertSymbol: (latex) => { inserted = latex } }))

    useMathEditorStore.getState().activeEditor?.insertSymbol('\\alpha')
    expect(useMathEditorStore.getState().activeEditorId).toBe('a')
    expect(inserted).toBe('\\alpha')
  })

  it('replaces the previous one when another editor registers', () => {
    useMathEditorStore.getState().setActiveEditor('a', handle())
    useMathEditorStore.getState().setActiveEditor('b', handle())

    expect(useMathEditorStore.getState().activeEditorId).toBe('b')
  })

  it('clears when the current owner asks', () => {
    useMathEditorStore.getState().setActiveEditor('a', handle())
    useMathEditorStore.getState().clearActiveEditor('a')

    expect(useMathEditorStore.getState().activeEditor).toBeNull()
    expect(useMathEditorStore.getState().activeEditorId).toBeNull()
  })

  // The exclusivity property the id-keyed design exists for: an editor that
  // has already lost the slot to another one cannot clear it out from under
  // the new owner just by acting (e.g. unmounting) after the fact.
  it('does not clear when a former owner asks after another editor has taken over', () => {
    useMathEditorStore.getState().setActiveEditor('a', handle())
    useMathEditorStore.getState().setActiveEditor('b', handle())

    useMathEditorStore.getState().clearActiveEditor('a')

    expect(useMathEditorStore.getState().activeEditorId).toBe('b')
    expect(useMathEditorStore.getState().activeEditor).not.toBeNull()
  })
})
