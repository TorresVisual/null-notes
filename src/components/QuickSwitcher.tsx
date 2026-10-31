import { useMemo, useState } from 'react'
import { useNotesStore } from '../store/notes'
import { useWorkspaceStore } from '../store/workspace'
import type { NoteMetadata } from '../types'
import { CommandDialog, Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from './ui/command'

interface QuickSwitcherProps {
  onClose: () => void
  onPick?: (path: string) => void
  title?: string
  exclude?: string | null
}

// Ranks a title match by where the query hits: a prefix match beats a
// mid-title match, and among ties the shorter title (the closer match) wins.
export function matchNotes(notes: NoteMetadata[], query: string): NoteMetadata[] {
  const q = query.trim().toLowerCase()
  if (!q) return notes.slice(0, 20)

  return notes
    .map((note) => {
      const title = note.title.toLowerCase()
      const index = title.indexOf(q)
      return { note, index }
    })
    .filter((m) => m.index !== -1)
    .sort((a, b) => a.index - b.index || a.note.title.length - b.note.title.length)
    .slice(0, 20)
    .map((m) => m.note)
}

export function QuickSwitcher({ onClose, onPick, title = 'Jump to note', exclude = null }: QuickSwitcherProps) {
  const [query, setQuery] = useState('')
  const notes = useNotesStore((s) => s.notes)
  const openTab = useWorkspaceStore((s) => s.openTab)

  const results = useMemo(
    () => matchNotes(exclude ? notes.filter((n) => n.path !== exclude) : notes, query),
    [notes, query, exclude],
  )

  function open(path: string) {
    if (onPick) onPick(path)
    else openTab(path)
    onClose()
  }

  return (
    <CommandDialog
      open
      onOpenChange={(next) => !next && onClose()}
      className="search-modal"
      title={title}
      description="Pick a note by title"
    >
      <Command shouldFilter={false}>
        <CommandInput
          className="search-modal-input"
          placeholder={`${title}…`}
          value={query}
          onValueChange={setQuery}
        />
        <CommandList className="search-results">
          {results.length > 0 && (
            <CommandGroup>
              {results.map((note) => (
                <CommandItem key={note.path} value={note.path} className="search-result items-stretch [&>svg]:hidden" onSelect={() => open(note.path)}>
                  <span className="search-result-title">{note.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {query.trim() !== '' && results.length === 0 && (
            <CommandEmpty className="search-empty">
              No notes match &ldquo;{query}&rdquo;
              <span className="empty-state-detail">Matches note titles — try part of the title instead.</span>
            </CommandEmpty>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
