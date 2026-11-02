import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkspacePicker } from './WorkspacePicker'
import { useWorkspaceStore } from '../store/workspace'
import { useWorkspace } from '../hooks/useWorkspace'
import { platform } from '@tauri-apps/plugin-os'
import { documentDir } from '@tauri-apps/api/path'
import { api } from '../lib/tauri'
import { setStoredGitToken } from '../lib/gitCredentials'
import { showToast } from '../store/toast'

vi.mock('../hooks/useWorkspace')
vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({ documentDir: vi.fn() }))
vi.mock('../lib/tauri', () => ({ api: { git: { cloneRepo: vi.fn() } } }))
vi.mock('../lib/gitCredentials', () => ({ setStoredGitToken: vi.fn() }))
vi.mock('../store/toast', () => ({ showToast: vi.fn() }))

let mockWorkspace: ReturnType<typeof useWorkspace>

beforeEach(() => {
  useWorkspaceStore.setState({ recentWorkspaces: [], folderLoading: false, folderError: null })
  vi.mocked(platform).mockReturnValue('windows')
  mockWorkspace = {
    openWorkspace: vi.fn(),
    openWorkspaceAt: vi.fn().mockResolvedValue(undefined),
    saveSession: vi.fn(),
    closeWorkspace: vi.fn(),
  }
  vi.mocked(useWorkspace).mockReturnValue(mockWorkspace)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('WorkspacePicker loading state', () => {
  it('disables the browse button and shows "Opening…" while a workspace is loading', () => {
    useWorkspaceStore.setState({ folderLoading: true })
    render(<WorkspacePicker />)

    const button = screen.getByRole('button', { name: /Opening…/ })
    expect(button).toBeDisabled()
  })

  it('shows the normal label and an enabled button when not loading', () => {
    render(<WorkspacePicker />)

    const button = screen.getByRole('button', { name: /Choose a folder…/ })
    expect(button).toBeEnabled()
  })
})

describe('WorkspacePicker open failure', () => {
  it('announces why a folder could not be opened', () => {
    useWorkspaceStore.setState({ folderError: 'No such file or directory (os error 2)' })
    render(<WorkspacePicker />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't open that folder — No such file or directory (os error 2)",
    )
  })

  it('shows no alert when nothing failed', () => {
    render(<WorkspacePicker />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('WorkspacePicker on mobile', () => {
  it('shows the onboarding form instead of the folder picker', () => {
    vi.mocked(platform).mockReturnValue('ios')

    render(<WorkspacePicker />)

    expect(screen.getByPlaceholderText('https://github.com/me/notes.git')).toBeInTheDocument()
    expect(screen.queryByText('Choose a folder…')).not.toBeInTheDocument()
  })

  it('stores the token and clones into the Documents dir on submit', async () => {
    const user = userEvent.setup()
    vi.mocked(platform).mockReturnValue('ios')
    vi.mocked(documentDir).mockResolvedValue('/var/mobile/Documents')
    vi.mocked(api.git.cloneRepo).mockResolvedValue('/var/mobile/Documents/notes')

    render(<WorkspacePicker />)
    await user.type(screen.getByPlaceholderText('https://github.com/me/notes.git'), 'https://github.com/me/notes.git')
    await user.type(screen.getByLabelText('Personal access token'), 'ghp_abc')
    await user.click(screen.getByRole('button', { name: /Clone workspace/ }))

    expect(setStoredGitToken).toHaveBeenCalledWith('ghp_abc')
    expect(api.git.cloneRepo).toHaveBeenCalledWith('https://github.com/me/notes.git', '/var/mobile/Documents')
    expect(mockWorkspace.openWorkspaceAt).toHaveBeenCalledWith('/var/mobile/Documents/notes')
  })

  it('shows a toast and stays on the form when clone fails', async () => {
    const user = userEvent.setup()
    vi.mocked(platform).mockReturnValue('ios')
    vi.mocked(documentDir).mockResolvedValue('/var/mobile/Documents')
    vi.mocked(api.git.cloneRepo).mockRejectedValue(new Error('authentication failed'))

    render(<WorkspacePicker />)
    await user.type(screen.getByPlaceholderText('https://github.com/me/notes.git'), 'https://github.com/me/notes.git')
    await user.type(screen.getByLabelText('Personal access token'), 'ghp_bad')
    await user.click(screen.getByRole('button', { name: /Clone workspace/ }))

    expect(showToast).toHaveBeenCalledWith("Couldn't clone the repository: authentication failed")
  })
})

describe('WorkspacePicker on desktop', () => {
  it('keeps the existing folder/clone buttons', () => {
    render(<WorkspacePicker />)

    expect(screen.getByText('Choose a folder…')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('https://github.com/me/notes.git')).not.toBeInTheDocument()
  })
})
