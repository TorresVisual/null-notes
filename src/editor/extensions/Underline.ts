import { Mark, markInputRule, markPasteRule, mergeAttributes } from '@tiptap/core'

export const Underline = Mark.create({
  name: 'underline',

  parseHTML() {
    return [{ tag: 'u' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['u', mergeAttributes(HTMLAttributes), 0]
  },

  addKeyboardShortcuts() {
    return {
      'Mod-u': () => this.editor.commands.toggleMark(this.name),
    }
  },

  addInputRules() {
    return [
      markInputRule({
        find: /(?:^|[^+])(\+\+([^+]+)\+\+)$/,
        type: this.type,
      }),
    ]
  },

  addPasteRules() {
    return [
      markPasteRule({
        find: /\+\+([^+]+)\+\+/g,
        type: this.type,
      }),
    ]
  },
})
