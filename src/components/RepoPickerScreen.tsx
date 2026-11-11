import { useEffect, useState } from 'react'
import { Check, Lock, Search } from 'lucide-react'
import { documentDir } from '@tauri-apps/api/path'
import { useWorkspace } from '../hooks/useWorkspace'
import { api } from '../lib/tauri'
import { failure } from '../lib/failure'
import { useMobileOnboardingStore } from '../store/mobileOnboarding'
import { useWorkspaceStore } from '../store/workspace'
import { showToast } from '../store/toast'
import type { GithubRepo } from '../types'
import { OnboardingTopBar } from './OnboardingTopBar'

export function RepoPickerScreen() {
  const setStep = useMobileOnboardingStore((s) => s.setStep)
  const { openWorkspaceAt } = useWorkspace()
  const [repos, setRepos] = useState<GithubRepo[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<GithubRepo | null>(null)
  const [cloning, setCloning] = useState(false)

  useEffect(() => {
    api.git
      .listGithubRepos()
      .then(setRepos)
      .catch((e) => setLoadError(failure('load your repositories', e)))
  }, [])

  async function clone(repo: GithubRepo) {
    setCloning(true)
    let clonedPath: string
    try {
      clonedPath = await api.git.cloneRepo(repo.url, await documentDir())
    } catch (e) {
      showToast(failure('clone the repository', e))
      setCloning(false)
      return
    }
    await openWorkspaceAt(clonedPath)
    const openError = useWorkspaceStore.getState().folderError
    if (openError) {
      showToast(failure('open the cloned repository', openError))
      setCloning(false)
    }
  }

  const needle = query.trim().toLowerCase()
  const all = repos ?? []
  const shown = all.filter((r) => r.nameWithOwner.toLowerCase().includes(needle))
  const owners = new Set(all.map((r) => r.nameWithOwner.split('/')[0]))
  const soleOwner = owners.size === 1 ? [...owners][0] : null

  return (
    <div className="mobile-onboarding">
      <OnboardingTopBar title="Choose your notes repo" onBack={() => setStep('start')} />
      <div className="mobile-onboarding-body mobile-onboarding-body--list">
        {loadError ? (
          <>
            <p className="workspace-picker-error" role="alert">{loadError}</p>
            <button className="mobile-onboarding-link" onClick={() => setStep('code')}>
              Sign in again
            </button>
          </>
        ) : repos === null ? (
          <p className="mobile-onboarding-wait">Loading your repositories…</p>
        ) : (
          <>
            <div className="mobile-onboarding-repos-head">
              <label className="mobile-onboarding-search">
                <Search size={18} aria-hidden />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`Search ${repos.length} repositories`}
                  disabled={cloning}
                />
              </label>
              {soleOwner && (
                <div className="mobile-onboarding-owner">
                  <span>{soleOwner}</span>
                  {needle && <span>{shown.length} of {repos.length}</span>}
                </div>
              )}
            </div>
            {shown.length === 0 ? (
              <p className="mobile-onboarding-wait">No repositories match.</p>
            ) : (
              <ul className="mobile-onboarding-repos">
                {shown.map((r) => {
                  const [owner, name] = r.nameWithOwner.split('/')
                  const isSelected = r.url === selected?.url
                  return (
                    <li key={r.url}>
                      <button
                        className={isSelected ? 'is-selected' : undefined}
                        aria-pressed={isSelected}
                        disabled={cloning}
                        onClick={() => setSelected(r)}
                      >
                        <span className="mobile-onboarding-repo-name">
                          {!soleOwner && <span className="mobile-onboarding-repo-owner">{owner}/</span>}
                          {name}
                        </span>
                        {r.isPrivate && <Lock size={16} className="mobile-onboarding-lock" role="img" aria-label="private" />}
                        {isSelected && <Check size={18} className="mobile-onboarding-tick" aria-hidden />}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </div>
      <div className="mobile-onboarding-foot">
        <button
          className="mobile-onboarding-cta"
          disabled={!selected || cloning}
          onClick={() => selected && void clone(selected)}
        >
          {cloning ? 'Cloning…' : selected ? `Clone ${selected.nameWithOwner.split('/')[1]}` : 'Choose a repository'}
        </button>
        <button className="mobile-onboarding-link" disabled={cloning} onClick={() => setStep('token')}>
          Enter a URL manually
        </button>
      </div>
    </div>
  )
}
