import { useEffect, useState } from 'react'
import type { SearchResult, SearchSort } from '../types'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import { useWorkspace } from '../hooks/useWorkspace'
import { firstPositiveTerm, parseSearchQuery } from '../lib/searchQuery'
import { setPendingHighlight } from '../lib/pendingHighlight'
import { takePendingSearch } from '../lib/pendingSearch'
import { sameBookmark } from '../lib/bookmarks'
import { useBookmarksStore } from '../store/bookmarks'
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
  const [query, setQuery] = useState(takePendingSearch)
  const [results, setResults] = useState<SearchResult[]>([])
  const [total, setTotal] = useState(0)
  const [allWorkspaces, setAllWorkspaces] = useState(false)
  const workspacePath = useWorkspaceStore((s) => s.path)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const recentSearches = useWorkspaceStore((s) => s.recentSearches)
  const addRecentSearch = useWorkspaceStore((s) => s.addRecentSearch)
  const sort = useWorkspaceStore((s) => s.searchSort)
  const setSort = useWorkspaceStore((s) => s.setSearchSort)
  const { openWorkspaceAt } = useWorkspace()
  const savedSearch = useBookmarksStore((s) =>
    s.items.some((b) => sameBookmark(b, { kind: 'search', query: query.trim() })),
  )

  useEffect(() => {
    if (!workspacePath) return
    const { text, folder, tag, type, task } = parseSearchQuery(query)
    if (!text && !folder && !tag && !type && !task) {
      setResults([])
      setTotal(0)
      return
    }
    let stale = false
    const timer = setTimeout(() => {
      api.notes
        .search(workspacePath, text, folder, tag, type, task, allWorkspaces, sort)
        .then((page) => {
          if (stale) return
          setResults(page.results)
          setTotal(page.total)
        })
        .catch(() => {
          if (stale) return
          setResults([])
          setTotal(0)
        })
    }, 150)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [query, workspacePath, allWorkspaces, sort])

  async function showMore() {
    if (!workspacePath) return
    const { text, folder, tag, type, task } = parseSearchQuery(query)
    const page = await api.notes.search(
      workspacePath, text, folder, tag, type, task, allWorkspaces, sort, results.length,
    )
    setResults((current) => [...current, ...page.results])
    setTotal(page.total)
  }

  async function open(result: SearchResult) {
    const { path, workspace } = result
    addRecentSearch(query)
    if (workspace !== workspacePath) {
      await openWorkspaceAt(workspace)
    }
    const term = firstPositiveTerm(parseSearchQuery(query).text)
    const page = term ? await api.pdf.findPage(path, term) : null
    openTab(path)
    if (term) {
      setPendingHighlight(path, term, false, page ?? undefined)
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
          placeholder={'Search notes… ("phrase", OR, -exclude, folder:, tag:, type:)'}
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
          {query.trim() !== '' && (
            <button
              type="button"
              className="search-save"
              onClick={(e) => {
                e.preventDefault()
                useBookmarksStore.getState().toggle({ kind: 'search', query: query.trim() })
              }}
            >
              {savedSearch ? 'Remove saved search' : 'Save this search'}
            </button>
          )}
        </label>
        {results.length > 0 && (
          <div className="search-meta">
            <span>{total} {total === 1 ? 'result' : 'results'}</span>
            <select
              className="search-sort"
              aria-label="Sort results"
              value={sort}
              onChange={(e) => setSort(e.target.value as SearchSort)}
            >
              <option value="relevance">Relevance</option>
              <option value="modified">Recently modified</option>
              <option value="name">Name (A–Z)</option>
            </select>
          </div>
        )}
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
              {results.length < total && (
                <CommandItem value="search-show-more" className="search-more items-stretch [&>svg]:hidden" onSelect={() => void showMore()}>
                  Show more ({results.length} of {total})
                </CommandItem>
              )}
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
