import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText } from 'lucide-react'
import { useNotesStore } from '../store/notes'
import { useWorkspaceStore } from '../store/workspace'
import type { NoteMetadata } from '../types'

interface QuickSwitcherProps {
  onClose: () => void
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

export function QuickSwitcher({ onClose }: QuickSwitcherProps) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const notes = useNotesStore((s) => s.notes)
  const openTab = useWorkspaceStore((s) => s.openTab)

  const results = useMemo(() => matchNotes(notes, query), [notes, query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setSelected(0)
  }, [query])

  function open(path: string) {
    openTab(path)
    onClose()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => Math.min(s + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      const hit = results[selected]
      if (hit) open(hit.path)
    }
  }

  return (
    <div className="search-overlay" onMouseDown={onClose}>
      <div
        className="search-modal"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="search-modal-input-wrap">
          <FileText size={16} />
          <input
            ref={inputRef}
            className="search-modal-input"
            type="text"
            placeholder="Jump to note…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {results.length > 0 && (
          <ul className="search-results" role="listbox">
            {results.map((note, i) => (
              <li
                key={note.path}
                role="option"
                aria-selected={i === selected}
                className={`search-result${i === selected ? ' selected' : ''}`}
                onMouseEnter={() => setSelected(i)}
                onClick={() => open(note.path)}
              >
                <span className="search-result-title">{note.title}</span>
              </li>
            ))}
          </ul>
        )}
        {query.trim() !== '' && results.length === 0 && (
          <p className="search-empty">
            No notes match &ldquo;{query}&rdquo;
            <span className="empty-state-detail">Matches note titles — try part of the title instead.</span>
          </p>
        )}
      </div>
    </div>
  )
}
