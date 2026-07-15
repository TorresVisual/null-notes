import { create } from 'zustand'
import type { NoteMetadata } from '../types'

interface NotesStore {
  notes: NoteMetadata[]
  folders: string[]
  tags: string[]
  setNotes: (notes: NoteMetadata[]) => void
  setFolders: (folders: string[]) => void
  setTags: (tags: string[]) => void
  addNote: (note: NoteMetadata) => void
  removeNote: (path: string) => void
}

export const useNotesStore = create<NotesStore>((set, get) => ({
  notes: [],
  folders: [],
  tags: [],
  setNotes: (notes) => set({ notes }),
  setFolders: (folders) => set({ folders }),
  setTags: (tags) => set({ tags }),
  addNote: (note) => set({ notes: [note, ...get().notes] }),
  removeNote: (path) =>
    set({ notes: get().notes.filter((n) => n.path !== path) }),
}))
