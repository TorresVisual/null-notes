import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import type { SearchResult } from '../types'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import { parseSearchQuery } from '../lib/searchQuery'

interface SearchModalProps {
  onClose: () => void
}

export function SearchModal({ onClose }: SearchModalProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const workspacePath = useWorkspaceStore((s) => s.path)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const recentSearches = useWorkspaceStore((s) => s.recentSearches)
  const addRecentSearch = useWorkspaceStore((s) => s.addRecentSearch)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!workspacePath) return
    const { text, folder, tag, type } = parseSearchQuery(query)
    if (!text && !folder && !tag && !type) {
      setResults([])
      return
    }
    const timer = setTimeout(() => {
      api.notes
        .search(workspacePath, text, folder, tag, type)
        .then((res) => {
          setResults(res)
          setSelected(0)
        })
        .catch(() => setResults([]))
    }, 150)
    return () => clearTimeout(timer)
  }, [query, workspacePath])

  function open(path: string) {
    addRecentSearch(query)
    openTab(path)
    onClose()
  }

  function runRecentSearch(q: string) {
    setQuery(q)
    inputRef.current?.focus()
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
            placeholder="Search notes… (try folder:, tag:, or type:)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {query.trim() === '' && recentSearches.length > 0 && (
          <ul className="search-recent">
            {recentSearches.map((q) => (
              <li key={q}>
                <button className="search-recent-item" onClick={() => runRecentSearch(q)}>
                  {q}
                </button>
              </li>
            ))}
          </ul>
        )}
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
          <p className="search-empty">
            No results for &ldquo;{query}&rdquo;
            <span className="empty-state-detail">
              Searches every note's title and body — try a shorter or different term, or narrow
              with <code>folder:</code>/<code>tag:</code>.
            </span>
          </p>
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
