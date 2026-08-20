import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorState } from '@tiptap/pm/state'
import { findSrCardSpans } from '../../lib/srCards'

/**
 * Highlights a review card's own text (P9-3) — decoration, not a node: the
 * underlying `::`/`{{...}}` text has to stay exactly as typed so it degrades
 * to readable plain Markdown in any other editor, so nothing is stored in
 * the document for this. Same "decoration not node" shape as `CodeLink`.
 */
const srCardHighlightKey = new PluginKey('srCardHighlight')

function decorate(state: EditorState): DecorationSet {
  const decorations: Decoration[] = []

  state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true
    for (const span of findSrCardSpans(node.text)) {
      decorations.push(
        Decoration.inline(pos + span.from, pos + span.to, {
          class: span.kind === 'qa' ? 'sr-card-qa' : 'sr-cloze',
        }),
      )
    }
    return true
  })

  return DecorationSet.create(state.doc, decorations)
}

export const SrCardHighlight = Extension.create({
  name: 'srCardHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: srCardHighlightKey,
        state: {
          init: (_, state) => decorate(state),
          apply: (tr, old, _oldState, newState) => (tr.docChanged ? decorate(newState) : old),
        },
        props: {
          decorations(state) {
            return srCardHighlightKey.getState(state) as DecorationSet
          },
        },
      }),
    ]
  },
})
