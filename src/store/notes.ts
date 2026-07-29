import { create } from 'zustand'
import type { NoteMetadata } from '../types'
import { forgetPosition } from '../lib/notePositions'

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
  removeNote: (path) => {
    // Path is the key everywhere, so a remembered cursor/scroll offset would
    // otherwise be handed to whatever note next takes this path.
    forgetPosition(path)
    set({ notes: get().notes.filter((n) => n.path !== path) })
  },
}))
