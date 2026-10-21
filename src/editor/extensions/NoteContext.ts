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
      // Same bridge as openFlashcardDialog, for the "reuse existing diagram"
      // picker (#39). range is null for the toolbar button, which inserts at
      // the cursor rather than replacing a slash-command range.
      openDiagramDialog: ((editor: Editor, range: Range | null) => void) | null
    }
  }
}

export const NoteContext = Extension.create({
  name: 'noteContext',
  // Seeded at construction because the Markdown is parsed before any effect can
  // assign it, and sidecar links resolve against it while parsing.
  addOptions() {
    return { notePath: '' }
  },
  addStorage() {
    return { notePath: this.options.notePath as string, openFlashcardDialog: null, openDiagramDialog: null }
  },
})
