import { describe, it, expect, afterEach, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { coreExtensions } from './index'
import { highlightSearchMatch } from './SearchJumpHighlight'

let editor: InstanceType<typeof Editor> | null = null

function mount(content: string) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  editor = new Editor({ element, extensions: coreExtensions, content })
  return editor
}

afterEach(() => {
  editor?.destroy()
  editor = null
  vi.useRealTimers()
})

describe('highlightSearchMatch', () => {
  it('highlights the first match', () => {
    const e = mount('<p>graph theory notes</p>')

    highlightSearchMatch(e, 'graph theory')

    expect(e.view.dom.querySelector('.search-jump-target')?.textContent).toBe('graph theory')
  })

  it('removes the highlight after 1500ms', () => {
    vi.useFakeTimers()
    const e = mount('<p>graph theory notes</p>')

    highlightSearchMatch(e, 'graph theory')
    expect(e.view.dom.querySelector('.search-jump-target')).not.toBeNull()

    vi.advanceTimersByTime(1500)
    expect(e.view.dom.querySelector('.search-jump-target')).toBeNull()
  })

  it('does nothing when the text has no match', () => {
    const e = mount('<p>graph theory notes</p>')

    highlightSearchMatch(e, 'never appears')

    expect(e.view.dom.querySelector('.search-jump-target')).toBeNull()
  })

  it('survives an unrelated transaction, unlike a raw DOM mutation would', () => {
    const e = mount('<p>graph theory notes</p>')

    highlightSearchMatch(e, 'graph theory')
    expect(e.view.dom.querySelector('.search-jump-target')).not.toBeNull()

    // A decoration is recomputed from plugin state on every redraw rather
    // than living as a one-off DOM write, so it should still be there after
    // a transaction that touches unrelated state (e.g. a focus/selection
    // change) forces ProseMirror to re-render.
    e.view.dispatch(e.state.tr.setSelection(e.state.selection))

    expect(e.view.dom.querySelector('.search-jump-target')).not.toBeNull()
  })
})
