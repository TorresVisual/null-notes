import { useEffect, useState } from 'react'
import { documentDir } from '@tauri-apps/api/path'
import { useWorkspace } from '../hooks/useWorkspace'
import { api } from '../lib/tauri'
import { failure } from '../lib/failure'
import { useMobileOnboardingStore } from '../store/mobileOnboarding'
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
    try {
      const clonedPath = await api.git.cloneRepo(repo.url, await documentDir())
      await openWorkspaceAt(clonedPath)
    } catch (e) {
      showToast(failure('clone the repository', e))
      setCloning(false)
    }
  }

  const needle = query.trim().toLowerCase()
  const shown = (repos ?? []).filter((r) => r.nameWithOwner.toLowerCase().includes(needle))

  return (
    <div className="mobile-onboarding">
      <OnboardingTopBar title="Choose your notes repo" onBack={() => setStep('start')} />
      <div className="mobile-onboarding-body mobile-onboarding-body--list">
        {loadError ? (
          <p className="workspace-picker-error" role="alert">{loadError}</p>
        ) : repos === null ? (
          <p className="mobile-onboarding-wait">Loading your repositories…</p>
        ) : (
          <>
            <input
              className="mobile-onboarding-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${repos.length} repositories`}
              disabled={cloning}
            />
            <ul className="mobile-onboarding-repos">
              {shown.map((r) => (
                <li key={r.url}>
                  <button
                    className={r.url === selected?.url ? 'is-selected' : undefined}
                    aria-pressed={r.url === selected?.url}
                    disabled={cloning}
                    onClick={() => setSelected(r)}
                  >
                    <span className="mobile-onboarding-repo-name">{r.nameWithOwner}</span>
                    {r.isPrivate && <span className="mobile-onboarding-pill">private</span>}
                  </button>
                </li>
              ))}
            </ul>
            {shown.length === 0 && <p className="mobile-onboarding-wait">No repositories match.</p>}
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
