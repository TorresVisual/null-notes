import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Editor } from '@tiptap/core'
import { findDocMatches } from './FindReplace'

/**
 * Backs the flash-highlight a Ctrl+K search result jump lands on
 * (`SearchModal`'s `open()`, via `pendingHighlight.ts`).
 *
 * A raw `classList.add` on a ProseMirror-managed node doesn't survive:
 * ProseMirror's own `DOMObserver` watches its editable DOM for exactly this
 * kind of unrecognized external mutation and reconciles it away on its next
 * flush — a redraw that lands within a frame or two of a note switch settling,
 * silently discarding the class before it's ever seen. Routing the highlight
 * through a `Decoration` instead keeps it inside ProseMirror's own model, so
 * a reconciliation redraw re-renders it rather than erasing it.
 */

const searchJumpKey = new PluginKey<{ from: number; to: number } | null>('searchJump')

export const SearchJumpHighlight = Extension.create({
  name: 'searchJumpHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<{ from: number; to: number } | null>({
        key: searchJumpKey,
        state: {
          init: () => null,
          apply(tr, value) {
            const meta = tr.getMeta(searchJumpKey)
            return meta !== undefined ? meta : value
          },
        },
        props: {
          decorations(state) {
            const range = searchJumpKey.getState(state)
            if (!range) return DecorationSet.empty
            return DecorationSet.create(state.doc, [
              Decoration.inline(range.from, range.to, { class: 'search-jump-target' }),
            ])
          },
        },
      }),
    ]
  },
})

/** Scrolls to and briefly highlights the first match of `text` in `editor`'s
 *  document. Matches within a single text node only, same scope limit as
 *  `FindReplace`'s single-node text matches. */
export function highlightSearchMatch(editor: Editor, text: string): void {
  const match = findDocMatches(editor.state.doc, text, {
    caseSensitive: false,
    wholeWord: false,
    useRegex: false,
  })[0]
  if (!match) return

  editor.view.dispatch(
    editor.state.tr.setMeta(searchJumpKey, { from: match.from, to: match.to }).scrollIntoView(),
  )
  setTimeout(() => {
    if (editor.isDestroyed) return
    editor.view.dispatch(editor.state.tr.setMeta(searchJumpKey, null))
  }, 1500)
}
