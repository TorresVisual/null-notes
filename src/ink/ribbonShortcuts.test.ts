import { describe, it, expect } from 'vitest'
import { toolForShortcut } from './ribbonShortcuts'

function press(key: string, extra: Partial<Parameters<typeof toolForShortcut>[0]> = {}) {
  return toolForShortcut({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    defaultPrevented: false,
    target: document.body,
    ...extra,
  })
}

describe('toolForShortcut', () => {
  it('maps P, E, L and T, either case', () => {
    expect(press('p')).toBe('pen')
    expect(press('E')).toBe('eraser')
    expect(press('l')).toBe('lasso')
    expect(press('T')).toBe('text')
  })

  it('ignores other keys', () => {
    expect(press('x')).toBeNull()
    expect(press('Escape')).toBeNull()
  })

  it('ignores chords with Ctrl, Meta or Alt', () => {
    expect(press('e', { ctrlKey: true })).toBeNull()
    expect(press('e', { metaKey: true })).toBeNull()
    expect(press('e', { altKey: true })).toBeNull()
  })

  it('ignores events already handled', () => {
    expect(press('e', { defaultPrevented: true })).toBeNull()
  })

  it('ignores typing into inputs, textareas and contenteditable', () => {
    const input = document.createElement('input')
    const area = document.createElement('textarea')
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    const inner = document.createElement('span')
    editable.append(inner)

    expect(press('e', { target: input })).toBeNull()
    expect(press('e', { target: area })).toBeNull()
    expect(press('e', { target: inner })).toBeNull()
  })

  it('still fires from a focused button', () => {
    expect(press('e', { target: document.createElement('button') })).toBe('eraser')
  })
})
