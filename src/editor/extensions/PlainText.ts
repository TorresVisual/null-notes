import { Text } from '@tiptap/extension-text'
import { LINK_SOURCE_PATTERN } from './LinkSource'

// Text that would re-parse as something other than text once its brackets are
// bare: a link or image destination, a reference definition, a footnote
// reference, a task checkbox, a wiki-link.
const BRACKETS_CHANGE_MEANING = /\]\(|\]:|\[\^|^\s*\[[ xX]\]|\[\[[^\]\n]+\]\]/

interface SerializerState {
  esc(str: string, startOfLine?: boolean): string
  text(text: string, escape?: boolean): void
}

interface SerializedText {
  text?: string
  marks?: readonly { type: { name: string } }[]
}

// prosemirror-markdown escapes every `[` and `]`, so typing `[` saved as `\[`.
// Brackets only need the backslash where dropping it would change the parse.
export const PlainText = Text.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: SerializerState, node: SerializedText) {
          const raw = node.text ?? ''
          // A link being edited as source: write it as the link it will be,
          // not as escaped text.
          const source = node.marks?.some((m) => m.type.name === 'linkSource') ? LINK_SOURCE_PATTERN.exec(raw) : null
          if (source) {
            const [, label = '', destination = ''] = source
            state.text(`[${state.esc(label)}](${destination.trim().replace(/ /g, '%20')})`, false)
            return
          }
          const escapeHtml = raw.replace(/&(?=#?\w+;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          if (BRACKETS_CHANGE_MEANING.test(raw)) {
            state.text(escapeHtml)
            return
          }
          const stock = state.esc
          state.esc = (str, startOfLine) => stock.call(state, str, startOfLine).replace(/\\([[\]])/g, '$1')
          try {
            state.text(escapeHtml)
          } finally {
            Reflect.deleteProperty(state, 'esc')
          }
        },
        parse: {},
      },
    }
  },
})
