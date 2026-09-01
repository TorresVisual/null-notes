import { Extension } from '@tiptap/core'
import type { Editor, Range } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Storage {
    noteContext: {
      notePath: string
      // Bridges the /flashcard slash command (which only has access to the
      // editor and the range it fired from, not app-level React state) to
      // Layout's overlay — the same shape notePath already bridges for
      // Ink Block/Diagram, but for a callback instead of a plain value.
      openFlashcardDialog: ((editor: Editor, range: Range) => void) | null
    }
  }
}

export const NoteContext = Extension.create({
  name: 'noteContext',
  addStorage() {
    return { notePath: '' as string, openFlashcardDialog: null }
  },
})
