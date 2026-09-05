import { useEffect, useState } from 'react'
import type { SearchResult } from '../types'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import { parseSearchQuery } from '../lib/searchQuery'
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
  const workspacePath = useWorkspaceStore((s) => s.path)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const recentSearches = useWorkspaceStore((s) => s.recentSearches)
  const addRecentSearch = useWorkspaceStore((s) => s.addRecentSearch)

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
        .then(setResults)
        .catch(() => setResults([]))
    }, 150)
    return () => clearTimeout(timer)
  }, [query, workspacePath])

  function open(path: string) {
    addRecentSearch(query)
    openTab(path)
    const { text } = parseSearchQuery(query)
    if (text) scrollToText(text)
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
                <CommandItem key={r.path} value={r.path} className="search-result items-stretch [&>svg]:hidden" onSelect={() => open(r.path)}>
                  <span className="search-result-title">{r.title}</span>
                  <span className="search-result-snippet">{renderSnippet(r.snippet)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {query.trim() !== '' && results.length === 0 && (
            <CommandEmpty className="search-empty">
              No results for &ldquo;{query}&rdquo;
              <span className="empty-state-detail">
                Searches every note's title and body — try a shorter or different term, or narrow
                with <code>folder:</code>/<code>tag:</code>.
              </span>
            </CommandEmpty>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

/** Scrolls to and briefly highlights the first match of `text` in the note
 *  just opened by search — mirrors CrossRef's `scrollToBlock`: the target
 *  note may still be mounting, so this retries across a bounded number of
 *  frames instead of giving up on the first miss. Matches within a single
 *  text node only, same scope limit as FindReplace's `findDocMatches`. */
export function scrollToText(text: string, attempt = 0): void {
  const root = document.querySelector('.note-editor .ProseMirror')
  if (root) {
    const needle = text.toLowerCase()
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.toLowerCase().includes(needle)) continue
      const el = node.parentElement
      el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
      el?.classList.add('search-jump-target')
      setTimeout(() => el?.classList.remove('search-jump-target'), 1500)
      return
    }
  }
  if (attempt < 90) requestAnimationFrame(() => scrollToText(text, attempt + 1))
}

function renderSnippet(snippet: string) {
  const parts = snippet.split(/(\[\[.*?\]\])/)
  return parts.map((part, i) =>
    part.startsWith('[[') && part.endsWith(']]')
      ? <mark key={i}>{part.slice(2, -2)}</mark>
      : <span key={i}>{part}</span>
  )
}
