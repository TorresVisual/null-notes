import { Mark, markInputRule, markPasteRule, mergeAttributes } from '@tiptap/core'

export const Highlight = Mark.create({
  name: 'highlight',

  parseHTML() {
    return [{ tag: 'mark' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['mark', mergeAttributes(HTMLAttributes), 0]
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-h': () => this.editor.commands.toggleMark(this.name),
    }
  },

  addInputRules() {
    return [
      markInputRule({
        find: /(?:^|[^=])(==([^=]+)==)$/,
        type: this.type,
      }),
    ]
  },

  addPasteRules() {
    return [
      markPasteRule({
        find: /==([^=]+)==/g,
        type: this.type,
      }),
    ]
  },
})
