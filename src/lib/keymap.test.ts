import { describe, it, expect } from 'vitest'
import { COMMANDS, bindingError, commandById, comboFromEvent, effectiveKeymap } from './keymap'

const key = (init: KeyboardEventInit) => comboFromEvent(new KeyboardEvent('keydown', init))

describe('comboFromEvent', () => {
  it('canonicalises modifiers and letter case, folding Meta into Ctrl', () => {
    expect(key({ key: 'p', ctrlKey: true, shiftKey: true })).toBe('Ctrl+Shift+P')
    expect(key({ key: 'P', metaKey: true })).toBe('Ctrl+P')
    expect(key({ key: 'Tab', ctrlKey: true, shiftKey: true })).toBe('Ctrl+Shift+Tab')
    expect(key({ key: 'ArrowLeft', altKey: true })).toBe('Alt+ArrowLeft')
  })

  it('ignores Shift on punctuation and returns null for a bare modifier', () => {
    expect(key({ key: '?', shiftKey: true })).toBe('?')
    expect(key({ key: 'Control', ctrlKey: true })).toBeNull()
  })
})

describe('effectiveKeymap', () => {
  it('uses defaults, honours overrides, and lets "" clear a default', () => {
    const map = effectiveKeymap({ search: 'Ctrl+Shift+S', 'quick-switch': '' })
    expect(map.search).toBe('Ctrl+Shift+S')
    expect(map['quick-switch']).toBe('')
    expect(map['new-note']).toBe('Ctrl+N')
  })

  it('has no two commands sharing a default', () => {
    const keys = COMMANDS.map((c) => c.defaultKey).filter(Boolean)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('editor group commands', () => {
  it('binds the split and focus commands and moves the sidebar toggle off the backslash key', () => {
    expect(commandById('split-editor')?.defaultKey).toBe('Ctrl+\\')
    expect(commandById('focus-next-group')?.defaultKey).toBe('Ctrl+Alt+ArrowRight')
    expect(commandById('focus-prev-group')?.defaultKey).toBe('Ctrl+Alt+ArrowLeft')
    expect(commandById('toggle-sidebar')?.defaultKey).toBe('Ctrl+Shift+B')
  })

  it('leaves the rarer group commands unbound but present', () => {
    for (const id of ['split-editor-down', 'close-editor-group', 'reset-split-ratio', 'toggle-split-direction']) {
      expect(commandById(id)).toBeDefined()
      expect(commandById(id)?.defaultKey).toBeUndefined()
    }
  })

  it('lets the new defaults be pressed', () => {
    expect(key({ key: '\\', ctrlKey: true })).toBe('Ctrl+\\')
    expect(key({ key: 'ArrowRight', ctrlKey: true, altKey: true })).toBe('Ctrl+Alt+ArrowRight')
  })
})

describe('bindingError', () => {
  const bindings = effectiveKeymap({})

  it('rejects reserved editing keys and unmodified keys', () => {
    expect(bindingError(bindings, 'search', 'Ctrl+C')).toMatch(/reserved/)
    expect(bindingError(bindings, 'search', 'Ctrl+Z')).toMatch(/reserved/)
    expect(bindingError(bindings, 'search', 'Tab')).toMatch(/Ctrl or Alt/)
  })

  it('names the command that already owns a combo, but allows re-binding a command to its own', () => {
    expect(bindingError(bindings, 'search', 'Ctrl+P')).toMatch(/Quick Switcher/)
    expect(bindingError(bindings, 'quick-switch', 'Ctrl+P')).toBeNull()
    expect(bindingError(bindings, 'search', 'Ctrl+Alt+J')).toBeNull()
  })
})
