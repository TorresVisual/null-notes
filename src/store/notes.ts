import { create } from 'zustand'
import type { NoteMetadata } from '../types'
import { forgetPosition } from '../lib/notePositions'
import { folderName } from '../lib/pathPrefix'

// The tree already reads a note's display name from its title (the H1
// heading), not its filename — rename_note rewrites that heading in place
// without touching the file on disk. Anywhere else that shows a note's name
// needs the same lookup, or it keeps showing the pre-rename filename forever.
export function noteTitle(notes: NoteMetadata[], path: string): string {
  return notes.find((n) => n.path === path)?.title ?? folderName(path).replace(/\.md$/, '')
}

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
