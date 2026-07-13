import { Extension } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Storage {
    noteContext: { notePath: string }
  }
}

export const NoteContext = Extension.create({
  name: 'noteContext',
  addStorage() {
    return { notePath: '' as string }
  },
})
