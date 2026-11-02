import { useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { GitBranch, Lock } from 'lucide-react'
import { api } from '../lib/tauri'
import { failure } from '../lib/failure'
import { useWorkspace } from '../hooks/useWorkspace'
import { showToast } from '../store/toast'
import type { GithubRepo } from '../types'
import {
  CommandDialog,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from './ui/command'

interface CloneWorkspaceDialogProps {
  onClose: () => void
}

type ReposState = 'loading' | 'available' | 'unavailable'

// #79's inbound half of the two-machine story: paste a URL, or (when `gh`
// is on PATH and signed in) pick from the user's own repos — `gh` stays
// opt-in machinery here exactly as it is for repo creation, never a hard
// dependency, so an unauthenticated/missing gh just falls back to the URL
// row alone rather than showing an error.
export function CloneWorkspaceDialog({ onClose }: CloneWorkspaceDialogProps) {
  const [repos, setRepos] = useState<GithubRepo[]>([])
  const [reposState, setReposState] = useState<ReposState>('loading')
  const [query, setQuery] = useState('')
  const [cloning, setCloning] = useState(false)
  const { openWorkspaceAt } = useWorkspace()

  useEffect(() => {
    api.git
      .listGithubRepos()
      .then((r) => {
        setRepos(r)
        setReposState('available')
      })
      .catch(() => setReposState('unavailable'))
  }, [])

  async function cloneFrom(url: string) {
    const parentDir = await open({ directory: true, multiple: false })
    if (!parentDir || Array.isArray(parentDir)) return
    setCloning(true)
    try {
      const clonedPath = await api.git.cloneRepo(url, parentDir)
      onClose()
      await openWorkspaceAt(clonedPath)
    } catch (e) {
      showToast(failure('clone the repository', e))
      setCloning(false)
    }
  }

  const trimmed = query.trim()
  const filtered = repos.filter((r) =>
    r.nameWithOwner.toLowerCase().includes(trimmed.toLowerCase()),
  )

  return (
    <CommandDialog
      open
      onOpenChange={(next) => !next && !cloning && onClose()}
      className="search-modal"
      title="Clone workspace"
      description="Clone an existing git-synced notes workspace onto this machine"
    >
      <Command shouldFilter={false}>
        <CommandInput
          className="search-modal-input"
          placeholder={
            reposState === 'unavailable' ? 'Repository URL…' : 'Search your repos, or paste a URL…'
          }
          value={query}
          onValueChange={setQuery}
          disabled={cloning}
        />
        <CommandList className="search-results">
          {trimmed !== '' && (
            <CommandGroup>
              <CommandItem
                value={`clone-url:${trimmed}`}
                className="clone-url-item"
                disabled={cloning}
                onSelect={() => void cloneFrom(trimmed)}
              >
                <GitBranch size={14} /> Clone from URL: <span className="clone-url-value">{trimmed}</span>
              </CommandItem>
            </CommandGroup>
          )}
          {reposState === 'available' && filtered.length > 0 && (
            <CommandGroup heading="Your repositories" className="clone-repo-group">
              {filtered.map((r) => (
                <CommandItem
                  key={r.url}
                  value={r.nameWithOwner}
                  className="clone-repo-item [&>svg]:hidden"
                  disabled={cloning}
                  onSelect={() => void cloneFrom(r.url)}
                >
                  <span className="clone-repo-name">{r.nameWithOwner}</span>
                  {r.isPrivate && (
                    <span className="clone-repo-private">
                      <Lock size={12} />
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {reposState === 'loading' && (
            <CommandEmpty className="search-empty">Loading your repositories…</CommandEmpty>
          )}
          {reposState === 'unavailable' && trimmed === '' && (
            <CommandEmpty className="search-empty">
              Paste a repository URL to clone it
              <span className="empty-state-detail">
                gh isn&apos;t available — install and sign in to browse your own repos here instead.
              </span>
            </CommandEmpty>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
