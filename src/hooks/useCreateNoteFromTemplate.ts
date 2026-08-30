import { useCreateNote } from './useCreateNote'
import type { NoteMetadata } from '../types'

// Same create/open/error-report flow as useCreateNote, just with a
// caller-supplied body instead of a synthesized "# {title}" heading.
export function useCreateNoteFromTemplate() {
  const createNote = useCreateNote()
  return (title: string, content: string): Promise<NoteMetadata | null> => createNote(title, content)
}
