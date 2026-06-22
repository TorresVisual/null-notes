import { create } from 'zustand'
import type { NoteMetadata } from '../types'

interface NotesStore {
  notes: NoteMetadata[]
  setNotes: (notes: NoteMetadata[]) => void
  addNote: (note: NoteMetadata) => void
  removeNote: (path: string) => void
}

export const useNotesStore = create<NotesStore>((set, get) => ({
  notes: [],
  setNotes: (notes) => set({ notes }),
  addNote: (note) => set({ notes: [note, ...get().notes] }),
  removeNote: (path) =>
    set({ notes: get().notes.filter((n) => n.path !== path) }),
}))
