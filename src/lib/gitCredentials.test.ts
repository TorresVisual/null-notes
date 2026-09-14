import { describe, it, expect, vi, afterEach } from 'vitest'
import { platform } from '@tauri-apps/plugin-os'
import { api } from './tauri'
import { getStoredGitToken, setStoredGitToken } from './gitCredentials'

vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn() }))
vi.mock('./tauri', () => ({
  api: { git: { getGitToken: vi.fn(), setGitToken: vi.fn() } },
}))

afterEach(() => vi.clearAllMocks())

describe('gitCredentials', () => {
  it('reads the stored token on iOS', async () => {
    vi.mocked(platform).mockReturnValue('ios')
    vi.mocked(api.git.getGitToken).mockResolvedValue('ghp_abc123')

    await expect(getStoredGitToken()).resolves.toBe('ghp_abc123')
    expect(api.git.getGitToken).toHaveBeenCalled()
  })

  it('returns an empty string on desktop without touching the keyring', async () => {
    vi.mocked(platform).mockReturnValue('windows')

    await expect(getStoredGitToken()).resolves.toBe('')
    expect(api.git.getGitToken).not.toHaveBeenCalled()
  })

  it('stores the token on iOS', async () => {
    vi.mocked(platform).mockReturnValue('ios')

    await setStoredGitToken('ghp_new')

    expect(api.git.setGitToken).toHaveBeenCalledWith('ghp_new')
  })

  it('does not store anything on desktop', async () => {
    vi.mocked(platform).mockReturnValue('windows')

    await setStoredGitToken('ghp_new')

    expect(api.git.setGitToken).not.toHaveBeenCalled()
  })
})
