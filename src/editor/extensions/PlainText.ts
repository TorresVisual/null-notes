import { Text } from '@tiptap/extension-text'

// Text that would re-parse as something other than text once its brackets are
// bare: a link or image destination, a reference definition, a footnote
// reference, a task checkbox.
const BRACKETS_CHANGE_MEANING = /\]\(|\]:|\[\^|^\s*\[[ xX]\]/

interface SerializerState {
  esc(str: string, startOfLine?: boolean): string
  text(text: string): void
}

// prosemirror-markdown escapes every `[` and `]`, so typing `[` saved as `\[`.
// Brackets only need the backslash where dropping it would change the parse.
export const PlainText = Text.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: SerializerState, node: { text?: string }) {
          const raw = node.text ?? ''
          const escapeHtml = raw.replace(/</g, '&lt;').replace(/>/g, '&gt;')
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
