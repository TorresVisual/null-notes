import { create } from 'zustand'
import type { NoteMetadata } from '../types'
import { forgetPosition } from '../lib/notePositions'
import { folderName } from '../lib/pathPrefix'

// The tree already reads a note's display name from its title (the H1
// heading) rather than reparsing the filename. `note_filename` sanitizes
// characters a filesystem can't hold (":" etc. become "-"), so the filename
// and the title can legitimately differ even right after a rename — the
// title is the one the user actually typed. Anywhere else that shows a
// note's name needs the same lookup, or it can show a mangled version of it.
export function noteTitle(notes: NoteMetadata[], path: string): string {
  return notes.find((n) => n.path === path)?.title ?? folderName(path).replace(/\.(md|canvas)$/, '')
}

interface NotesStore {
  notes: NoteMetadata[]
  folders: string[]
  canvases: string[]
  tags: string[]
  setNotes: (notes: NoteMetadata[]) => void
  setFolders: (folders: string[]) => void
  setCanvases: (canvases: string[]) => void
  setTags: (tags: string[]) => void
  addNote: (note: NoteMetadata) => void
  removeNote: (path: string) => void
}

export const useNotesStore = create<NotesStore>((set, get) => ({
  notes: [],
  folders: [],
  canvases: [],
  tags: [],
  setNotes: (notes) => set({ notes }),
  setFolders: (folders) => set({ folders }),
  setCanvases: (canvases) => set({ canvases }),
  setTags: (tags) => set({ tags }),
  addNote: (note) => set({ notes: [note, ...get().notes] }),
  removeNote: (path) => {
    // Path is the key everywhere, so a remembered cursor/scroll offset would
    // otherwise be handed to whatever note next takes this path.
    forgetPosition(path)
    set({ notes: get().notes.filter((n) => n.path !== path) })
  },
}))
