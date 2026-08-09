import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { NodeRangeSelection, isNodeRangeSelection } from '@tiptap/extension-node-range'
import { coreExtensions } from './index'

let editor: Editor | null = null

function mount(content: string): Editor {
  editor = new Editor({ element: document.createElement('div'), extensions: coreExtensions, content })
  return editor
}

// NodeRangeSelection can be constructed and dispatched independent of whether
// the NodeRange extension is registered — the extension's own job is mouse
// handling and decorations (both DOM/view concerns, out of scope for jsdom
// per this plan's Global Constraints). This test is a regression/integration
// check — confirming NodeRangeSelection composes correctly with the full
// coreExtensions set (no plugin conflicts with Divider's custom commands,
// CodeBlockEditor's key handling, etc.) — not a fail-first TDD test.
describe('multi-block range selection', () => {
  it('selects a run of top-level blocks as a NodeRangeSelection', () => {
    const e = mount('<p>one</p><p>two</p><p>three</p>')
    const selection = NodeRangeSelection.create(e.state.doc, 0, e.state.doc.content.size)
    e.view.dispatch(e.state.tr.setSelection(selection))
    expect(isNodeRangeSelection(e.state.selection)).toBe(true)
  })

  it('deletes every block in the range with one command', () => {
    const e = mount('<p>one</p><p>two</p><p>three</p>')
    const selection = NodeRangeSelection.create(e.state.doc, 0, e.state.doc.content.size)
    e.view.dispatch(e.state.tr.setSelection(selection))
    e.commands.deleteSelection()
    expect(e.state.doc.textContent).toBe('')
  })
})

afterEach(() => {
  editor?.destroy()
  editor = null
})
