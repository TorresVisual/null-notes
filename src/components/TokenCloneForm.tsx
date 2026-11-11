import { useState } from 'react'
import { GitBranch } from 'lucide-react'
import { documentDir } from '@tauri-apps/api/path'
import { useWorkspace } from '../hooks/useWorkspace'
import { setStoredGitToken } from '../lib/gitCredentials'
import { api } from '../lib/tauri'
import { failure } from '../lib/failure'
import { showToast } from '../store/toast'

export function TokenCloneForm() {
  const { openWorkspaceAt } = useWorkspace()
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [cloning, setCloning] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setCloning(true)
    try {
      await setStoredGitToken(token)
      const clonedPath = await api.git.cloneRepo(url, await documentDir())
      await openWorkspaceAt(clonedPath)
    } catch (err) {
      showToast(failure('clone the repository', err))
      setCloning(false)
    }
  }

  return (
    <form className="workspace-picker-onboarding" onSubmit={(e) => void submit(e)}>
      <p className="workspace-picker-subtitle">
        Clone an existing git-synced notes workspace from your desktop.
      </p>
      <label className="workspace-picker-field">
        Repository URL
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/me/notes.git"
          disabled={cloning}
          required
        />
      </label>
      <label className="workspace-picker-field">
        Personal access token
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          disabled={cloning}
          required
        />
      </label>
      <button className="workspace-picker-browse" type="submit" disabled={cloning}>
        <GitBranch size={14} /> {cloning ? 'Cloning…' : 'Clone workspace'}
      </button>
    </form>
  )
}
