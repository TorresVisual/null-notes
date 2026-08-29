import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { useFocusModeStore } from '../../store/focusMode'

const { Editor } = await import('@tiptap/core')
const { coreExtensions } = await import('./index')

let editor: InstanceType<typeof Editor> | null = null

function mount(content: string) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  editor = new Editor({ element, extensions: coreExtensions, content })
  return editor
}

function caretIn(e: InstanceType<typeof Editor>, needle: string): void {
  let position: number | null = null
  e.state.doc.descendants((node, pos) => {
    if (position !== null) return false
    if (!node.isText) return true
    const index = (node.text ?? '').indexOf(needle)
    if (index !== -1) position = pos + index
    return true
  })
  if (position === null) throw new Error(`no text node containing "${needle}"`)
  e.commands.setTextSelection(position)
}

function dimmedTexts(e: InstanceType<typeof Editor>): string[] {
  return [...e.view.dom.querySelectorAll('.focus-mode-dim')].map((el) => el.textContent ?? '')
}

beforeEach(() => {
  useFocusModeStore.setState({ enabled: false })
})

afterEach(() => {
  editor?.destroy()
  editor = null
  useFocusModeStore.setState({ enabled: false })
})

describe('FocusMode dimming', () => {
  it('dims nothing while disabled', () => {
    const e = mount('<p>alpha</p><p>beta</p>')
    caretIn(e, 'alpha')

    expect(dimmedTexts(e)).toEqual([])
  })

  it('dims every top-level block except the one containing the caret', () => {
    const e = mount('<p>alpha</p><p>beta</p><p>gamma</p>')
    useFocusModeStore.getState().toggle()
    caretIn(e, 'beta')

    expect(dimmedTexts(e).sort()).toEqual(['alpha', 'gamma'])
  })

  it('keeps a whole list undimmed when the caret is inside one of its items', () => {
    const e = mount('<p>prose</p><ul><li>one</li><li>two</li></ul>')
    useFocusModeStore.getState().toggle()
    caretIn(e, 'two')

    // The schema auto-appends an empty trailing paragraph after a list (for
    // cursor accessibility) — it's correctly dimmed too, just not asserted
    // on by name here.
    const dimmed = dimmedTexts(e).filter((text) => text.length > 0)
    expect(dimmed).toEqual(['prose'])
  })

  it('re-dims as the caret moves, with no doc change', () => {
    const e = mount('<p>alpha</p><p>beta</p>')
    useFocusModeStore.getState().toggle()
    caretIn(e, 'alpha')
    expect(dimmedTexts(e)).toEqual(['beta'])

    caretIn(e, 'beta')
    expect(dimmedTexts(e)).toEqual(['alpha'])
  })

  it('clears dimming immediately when toggled off', () => {
    const e = mount('<p>alpha</p><p>beta</p>')
    useFocusModeStore.getState().toggle()
    caretIn(e, 'alpha')
    expect(dimmedTexts(e)).toEqual(['beta'])

    useFocusModeStore.getState().toggle()

    expect(dimmedTexts(e)).toEqual([])
  })
})
