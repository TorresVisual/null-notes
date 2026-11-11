import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { openUrl } from '@tauri-apps/plugin-opener'
import { documentDir } from '@tauri-apps/api/path'
import { MobileOnboarding } from './MobileOnboarding'
import { useWorkspace } from '../hooks/useWorkspace'
import { api } from '../lib/tauri'
import { getStoredGitToken } from '../lib/gitCredentials'
import type { GithubDeviceCode, GithubPollOutcome } from '../types'

vi.mock('../hooks/useWorkspace')
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({ documentDir: vi.fn() }))
vi.mock('../lib/gitCredentials', () => ({
  setStoredGitToken: vi.fn(),
  getStoredGitToken: vi.fn(),
}))
vi.mock('../store/toast', () => ({ showToast: vi.fn() }))
vi.mock('../lib/tauri', () => ({
  api: {
    git: {
      githubDeviceStart: vi.fn(),
      githubDevicePoll: vi.fn(),
      listGithubRepos: vi.fn(),
      cloneRepo: vi.fn(),
    },
  },
}))

const code: GithubDeviceCode = {
  deviceCode: 'dc_123',
  userCode: 'WDJB-MJHT',
  verificationUri: 'https://github.com/login/device',
  expiresIn: 900,
  interval: 1,
}

let openWorkspaceAt: Mock<(selected: string) => Promise<void>>

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  openWorkspaceAt = vi.fn<(selected: string) => Promise<void>>().mockResolvedValue(undefined)
  vi.mocked(useWorkspace).mockReturnValue({
    openWorkspace: vi.fn(),
    openWorkspaceAt,
    openSingleNote: vi.fn(),
    saveSession: vi.fn(),
    closeWorkspace: vi.fn(),
  })
  vi.mocked(getStoredGitToken).mockResolvedValue('')
  vi.mocked(api.git.githubDeviceStart).mockResolvedValue(code)
  vi.mocked(api.git.listGithubRepos).mockResolvedValue([
    { nameWithOwner: 'me/uni-notes', url: 'https://github.com/me/uni-notes', isPrivate: true },
    { nameWithOwner: 'me/dotfiles', url: 'https://github.com/me/dotfiles', isPrivate: false },
  ])
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

async function startSignIn() {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  render(<MobileOnboarding />)
  await user.click(await screen.findByRole('button', { name: /Sign in with GitHub/ }))
  await screen.findByText('WDJB-MJHT')
  return user
}

async function pollOnce(outcome: GithubPollOutcome, seconds = 1) {
  vi.mocked(api.git.githubDevicePoll).mockResolvedValueOnce(outcome)
  await act(() => vi.advanceTimersByTimeAsync(seconds * 1000))
}

describe('MobileOnboarding device flow', () => {
  it('shows the code and copies it before opening GitHub', async () => {
    const user = await startSignIn()

    await user.click(screen.getByRole('button', { name: 'Copy code and open GitHub' }))

    expect(await navigator.clipboard.readText()).toBe('WDJB-MJHT')
    expect(openUrl).toHaveBeenCalledWith('https://github.com/login/device')
  })

  it('keeps waiting while GitHub reports pending, then moves to the repo picker', async () => {
    await startSignIn()

    await pollOnce('pending')
    expect(screen.getByText('Waiting for GitHub…')).toBeInTheDocument()

    await pollOnce('authorized')
    expect(await screen.findByText('me/uni-notes')).toBeInTheDocument()
  })

  it('backs off by five seconds after slow_down', async () => {
    await startSignIn()

    await pollOnce('slowDown')
    expect(api.git.githubDevicePoll).toHaveBeenCalledTimes(1)

    await act(() => vi.advanceTimersByTimeAsync(5000))
    expect(api.git.githubDevicePoll).toHaveBeenCalledTimes(1)
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(api.git.githubDevicePoll).toHaveBeenCalledTimes(2)
  })

  it('offers a retry when the code expires', async () => {
    await startSignIn()

    await pollOnce('expired')

    expect(screen.getByRole('alert')).toHaveTextContent('This code expired.')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('stops polling once the user cancels', async () => {
    const user = await startSignIn()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await act(() => vi.advanceTimersByTimeAsync(5000))

    expect(api.git.githubDevicePoll).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Sign in with GitHub/ })).toBeInTheDocument()
  })
})

describe('MobileOnboarding repo picker', () => {
  async function reachPicker() {
    const user = await startSignIn()
    await pollOnce('authorized')
    await screen.findByText('me/uni-notes')
    return user
  }

  it('clones the chosen repo into the Documents dir and opens it', async () => {
    vi.mocked(documentDir).mockResolvedValue('/docs')
    vi.mocked(api.git.cloneRepo).mockResolvedValue('/docs/uni-notes')
    const user = await reachPicker()

    expect(screen.getByRole('button', { name: 'Choose a repository' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /me\/uni-notes/ }))
    await user.click(screen.getByRole('button', { name: 'Clone uni-notes' }))

    expect(api.git.cloneRepo).toHaveBeenCalledWith('https://github.com/me/uni-notes', '/docs')
    expect(openWorkspaceAt).toHaveBeenCalledWith('/docs/uni-notes')
  })

  it('filters repos by the search text', async () => {
    const user = await reachPicker()

    await user.type(screen.getByPlaceholderText('Search 2 repositories'), 'dot')

    expect(screen.queryByText('me/uni-notes')).not.toBeInTheDocument()
    expect(screen.getByText('me/dotfiles')).toBeInTheDocument()
  })

  it('falls back to manual entry when the list cannot load', async () => {
    vi.mocked(api.git.listGithubRepos).mockRejectedValue(new Error('401'))
    await startSignIn()
    await pollOnce('authorized')

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your repositories: 401")
    expect(screen.getByRole('button', { name: 'Enter a URL manually' })).toBeEnabled()
  })

  it('offers a fresh sign-in when the stored token is rejected', async () => {
    vi.mocked(getStoredGitToken).mockResolvedValue('gho_stale')
    vi.mocked(api.git.listGithubRepos).mockRejectedValue(new Error('401'))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<MobileOnboarding />)

    await user.click(await screen.findByRole('button', { name: 'Sign in again' }))

    expect(await screen.findByText('WDJB-MJHT')).toBeInTheDocument()
  })
})

describe('MobileOnboarding after a restart', () => {
  it('goes straight to the repo picker when a token is already stored', async () => {
    vi.mocked(getStoredGitToken).mockResolvedValue('gho_saved')
    render(<MobileOnboarding />)

    expect(await screen.findByText('me/uni-notes')).toBeInTheDocument()
    expect(api.git.githubDeviceStart).not.toHaveBeenCalled()
  })
})
