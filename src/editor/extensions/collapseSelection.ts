import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

// Collapsing only ever hides a node's body via CSS — the ProseMirror selection
// is never touched by that on its own, so a cursor left inside the body would
// keep silently accepting keystrokes into now-invisible content. Move it out to
// just before the node whenever a collapse would otherwise strand it there.
export function moveSelectionOutOf(editor: Editor, pos: number, nodeSize: number): void {
  const { from, to } = editor.state.selection
  if (from < pos || to > pos + nodeSize) return
  // TipTap's `focus(number)` command constructs a TextSelection at that exact
  // position rather than searching for the nearest valid one — it throws/no-ops
  // on a raw block-boundary position like this node's own start.
  // TextSelection.near does the search: bias -1 targets just before the node
  // (searching backward finds the preceding block's content); at doc position 0
  // there's nothing before, so fall back to bias 1 from just after the node.
  const target = pos > 0 ? pos : pos + nodeSize
  const bias = pos > 0 ? -1 : 1
  const selection = TextSelection.near(editor.state.doc.resolve(target), bias)
  editor.view.dispatch(editor.state.tr.setSelection(selection))
  editor.commands.focus()
}
