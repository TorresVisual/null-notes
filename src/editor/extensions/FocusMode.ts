import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorState } from '@tiptap/pm/state'
import { useFocusModeStore } from '../../store/focusMode'

/**
 * Dims every top-level block except the one containing the caret, while
 * focus mode is on (`useFocusModeStore`, toggled by `Layout.tsx`'s
 * `Ctrl+Shift+F`). "Block" means a direct child of the document — if the
 * caret is inside a list or table, the whole list/table stays undimmed,
 * not just the one item/cell; dimming individual list items mid-edit would
 * look broken rather than calming.
 *
 * Depends only on `state.selection`/`state.doc`, so it needs no plugin
 * state of its own — `decorations(state)` is recomputed by ProseMirror on
 * every view update, including a plain caret move with no doc change. The
 * one thing that isn't a ProseMirror transaction is the Zustand toggle
 * itself, so the plugin subscribes to the store and dispatches an empty
 * transaction purely to force a redraw — the same shape
 * `CodeBlockOpenInIde.ts`'s own `redraw()` uses for its async-resolve case.
 */

const focusModeKey = new PluginKey('focusMode')

export function decorateFocusMode(state: EditorState, enabled: boolean): DecorationSet {
  if (!enabled) return DecorationSet.empty

  const pos = state.selection.from
  const decorations: Decoration[] = []

  state.doc.forEach((node, offset) => {
    const from = offset
    const to = offset + node.nodeSize
    const isActive = pos >= from && pos < to
    if (!isActive) {
      decorations.push(Decoration.node(from, to, { class: 'focus-mode-dim' }))
    }
  })

  return DecorationSet.create(state.doc, decorations)
}

export const FocusMode = Extension.create({
  name: 'focusMode',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: focusModeKey,
        props: {
          decorations(state) {
            return decorateFocusMode(state, useFocusModeStore.getState().enabled)
          },
        },
        view(view) {
          const unsubscribe = useFocusModeStore.subscribe(() => view.dispatch(view.state.tr))
          return { destroy: unsubscribe }
        },
      }),
    ]
  },
})
