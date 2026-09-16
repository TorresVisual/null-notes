import { useEffect, useState } from 'react'
import type { SearchResult } from '../types'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import { useWorkspace } from '../hooks/useWorkspace'
import { parseSearchQuery } from '../lib/searchQuery'
import { setPendingHighlight } from '../lib/pendingHighlight'
import {
  CommandDialog,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from './ui/command'

interface SearchModalProps {
  onClose: () => void
}

export function SearchModal({ onClose }: SearchModalProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [allWorkspaces, setAllWorkspaces] = useState(false)
  const workspacePath = useWorkspaceStore((s) => s.path)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const recentSearches = useWorkspaceStore((s) => s.recentSearches)
  const addRecentSearch = useWorkspaceStore((s) => s.addRecentSearch)
  const { openWorkspaceAt } = useWorkspace()

  useEffect(() => {
    if (!workspacePath) return
    const { text, folder, tag, type } = parseSearchQuery(query)
    if (!text && !folder && !tag && !type) {
      setResults([])
      return
    }
    const timer = setTimeout(() => {
      api.notes
        .search(workspacePath, text, folder, tag, type, allWorkspaces)
        .then(setResults)
        .catch(() => setResults([]))
    }, 150)
    return () => clearTimeout(timer)
  }, [query, workspacePath, allWorkspaces])

  async function open(result: SearchResult) {
    const { path, workspace } = result
    addRecentSearch(query)
    if (workspace !== workspacePath) {
      await openWorkspaceAt(workspace)
    }
    openTab(path)
    const { text } = parseSearchQuery(query)
    if (text) {
      setPendingHighlight(path, text)
      // NoteEditor may already be mounted for `path` (it was already the
      // active tab), in which case openTab above triggers no notePath/content
      // change for it to react to — this event covers that case; a fresh
      // mount picks the same pending highlight up on its own.
      window.dispatchEvent(new Event('search:jump'))
    }
    onClose()
  }

  return (
    <CommandDialog
      open
      onOpenChange={(next) => !next && onClose()}
      className="search-modal"
      title="Search notes"
      description="Search every note's title and body"
    >
      <Command shouldFilter={false}>
        <CommandInput
          className="search-modal-input"
          placeholder="Search notes… (try folder:, tag:, or type:)"
          value={query}
          onValueChange={setQuery}
        />
        <label className="search-scope-toggle">
          <input
            type="checkbox"
            checked={allWorkspaces}
            onChange={(e) => setAllWorkspaces(e.target.checked)}
          />
          Search all workspaces
        </label>
        <CommandList className="search-results">
          {query.trim() === '' && recentSearches.length > 0 && (
            <CommandGroup className="search-recent">
              {recentSearches.map((q) => (
                <CommandItem key={q} value={q} className="search-recent-item items-stretch [&>svg]:hidden" onSelect={() => setQuery(q)}>
                  {q}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {results.length > 0 && (
            <CommandGroup>
              {results.map((r) => (
                <CommandItem key={r.path} value={r.path} className="search-result items-stretch [&>svg]:hidden" onSelect={() => void open(r)}>
                  <span className="search-result-title">
                    {r.title}
                    {allWorkspaces && (
                      <span className="search-result-workspace">{workspaceName(r.workspace)}</span>
                    )}
                  </span>
                  <span className="search-result-snippet">{renderSnippet(r.snippet)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {query.trim() !== '' && results.length === 0 && (
            <CommandEmpty className="search-empty">
              No results for &ldquo;{query}&rdquo;
              <span className="empty-state-detail">
                Searches every note&apos;s title and body — try a shorter or different term, or narrow
                with <code>folder:</code>/<code>tag:</code>.
              </span>
            </CommandEmpty>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

function workspaceName(workspace: string) {
  return workspace.split(/[/\\]/).pop() || workspace
}

function renderSnippet(snippet: string) {
  const parts = snippet.split(/(\[\[.*?\]\])/)
  return parts.map((part, i) =>
    part.startsWith('[[') && part.endsWith(']]')
      ? <mark key={i}>{part.slice(2, -2)}</mark>
      : <span key={i}>{part}</span>
  )
}
