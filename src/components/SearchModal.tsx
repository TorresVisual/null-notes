import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import type { SearchResult } from '../types'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'

interface SearchModalProps {
  onClose: () => void
}

export function SearchModal({ onClose }: SearchModalProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const openTab = useWorkspaceStore((s) => s.openTab)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }
    const timer = setTimeout(() => {
      api.notes.search(query).then((res) => {
        setResults(res)
        setSelected(0)
      }).catch(() => setResults([]))
    }, 150)
    return () => clearTimeout(timer)
  }, [query])

  function open(path: string) {
    openTab(path)
    onClose()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'ArrowDown') {
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
          <Search size={16} />
          <input
            ref={inputRef}
            className="search-modal-input"
            type="text"
            placeholder="Search notes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {results.length > 0 && (
          <ul className="search-results" role="listbox">
            {results.map((r, i) => (
              <li
                key={r.path}
                role="option"
                aria-selected={i === selected}
                className={`search-result${i === selected ? ' selected' : ''}`}
                onMouseEnter={() => setSelected(i)}
                onClick={() => open(r.path)}
              >
                <span className="search-result-title">{r.title}</span>
                <span className="search-result-snippet">{renderSnippet(r.snippet)}</span>
              </li>
            ))}
          </ul>
        )}
        {query.trim() !== '' && results.length === 0 && (
          <p className="search-empty">No results for &ldquo;{query}&rdquo;</p>
        )}
      </div>
    </div>
  )
}

function renderSnippet(snippet: string) {
  const parts = snippet.split(/(\[\[.*?\]\])/)
  return parts.map((part, i) =>
    part.startsWith('[[') && part.endsWith(']]')
      ? <mark key={i}>{part.slice(2, -2)}</mark>
      : <span key={i}>{part}</span>
  )
}
