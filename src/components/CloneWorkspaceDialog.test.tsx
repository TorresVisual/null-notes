import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CloneWorkspaceDialog } from './CloneWorkspaceDialog'
import { api } from '../lib/tauri'
import { open } from '@tauri-apps/plugin-dialog'
import { showToast } from '../store/toast'
import { useWorkspace } from '../hooks/useWorkspace'

vi.mock('../lib/tauri', () => ({
  api: { git: { listGithubRepos: vi.fn(), cloneRepo: vi.fn() } },
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}))
vi.mock('../store/toast', () => ({ showToast: vi.fn() }))
vi.mock('../hooks/useWorkspace', () => ({
  useWorkspace: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const REPOS = [
  { nameWithOwner: 'me/DSA-Notes', url: 'https://github.com/me/DSA-Notes.git', isPrivate: true },
  { nameWithOwner: 'me/Analysis-2', url: 'https://github.com/me/Analysis-2.git', isPrivate: false },
]

function setup() {
  const openWorkspaceAt = vi.fn().mockResolvedValue(undefined)
  vi.mocked(useWorkspace).mockReturnValue({
    openWorkspace: vi.fn(),
    openWorkspaceAt,
    saveSession: vi.fn(),
    closeWorkspace: vi.fn(),
  })
  return { openWorkspaceAt }
}

describe('CloneWorkspaceDialog', () => {
  it('lists the user\'s own repos when gh is available', async () => {
    vi.mocked(api.git.listGithubRepos).mockResolvedValue(REPOS)
    setup()

    render(<CloneWorkspaceDialog onClose={vi.fn()} />)

    expect(await screen.findByText('me/DSA-Notes')).toBeInTheDocument()
    expect(screen.getByText('me/Analysis-2')).toBeInTheDocument()
  })

  it('falls back to a plain URL prompt when gh is unavailable', async () => {
    vi.mocked(api.git.listGithubRepos).mockRejectedValue(new Error('gh not available'))
    setup()

    render(<CloneWorkspaceDialog onClose={vi.fn()} />)

    expect(await screen.findByText('Paste a repository URL to clone it')).toBeInTheDocument()
  })

  it('clones the picked repo into the chosen folder and opens it', async () => {
    const user = userEvent.setup()
    vi.mocked(api.git.listGithubRepos).mockResolvedValue(REPOS)
    vi.mocked(open).mockResolvedValue('/parent')
    vi.mocked(api.git.cloneRepo).mockResolvedValue('/parent/DSA-Notes')
    const { openWorkspaceAt } = setup()
    const onClose = vi.fn()

    render(<CloneWorkspaceDialog onClose={onClose} />)
    await user.click(await screen.findByText('me/DSA-Notes'))

    expect(api.git.cloneRepo).toHaveBeenCalledWith(
      'https://github.com/me/DSA-Notes.git',
      '/parent',
    )
    expect(onClose).toHaveBeenCalledOnce()
    expect(openWorkspaceAt).toHaveBeenCalledWith('/parent/DSA-Notes')
  })

  it('clones a pasted URL not in the repo list', async () => {
    const user = userEvent.setup()
    vi.mocked(api.git.listGithubRepos).mockResolvedValue(REPOS)
    vi.mocked(open).mockResolvedValue('/parent')
    vi.mocked(api.git.cloneRepo).mockResolvedValue('/parent/other-repo')
    setup()

    render(<CloneWorkspaceDialog onClose={vi.fn()} />)
    await user.type(await screen.findByRole('combobox'), 'https://example.com/other-repo.git')
    await user.click(screen.getByText(/Clone from URL:/))

    expect(api.git.cloneRepo).toHaveBeenCalledWith('https://example.com/other-repo.git', '/parent')
  })

  it('does not clone when the folder picker is cancelled', async () => {
    const user = userEvent.setup()
    vi.mocked(api.git.listGithubRepos).mockResolvedValue(REPOS)
    vi.mocked(open).mockResolvedValue(null)
    setup()

    render(<CloneWorkspaceDialog onClose={vi.fn()} />)
    await user.click(await screen.findByText('me/DSA-Notes'))

    expect(api.git.cloneRepo).not.toHaveBeenCalled()
  })

  it('shows a toast and keeps the dialog open when the clone fails', async () => {
    const user = userEvent.setup()
    vi.mocked(api.git.listGithubRepos).mockResolvedValue(REPOS)
    vi.mocked(open).mockResolvedValue('/parent')
    vi.mocked(api.git.cloneRepo).mockRejectedValue(new Error('git clone failed'))
    setup()
    const onClose = vi.fn()

    render(<CloneWorkspaceDialog onClose={onClose} />)
    await user.click(await screen.findByText('me/DSA-Notes'))

    expect(await screen.findByText('me/DSA-Notes')).toBeInTheDocument()
    expect(showToast).toHaveBeenCalledWith("Couldn't clone the repository: git clone failed")
    expect(onClose).not.toHaveBeenCalled()
  })
})
