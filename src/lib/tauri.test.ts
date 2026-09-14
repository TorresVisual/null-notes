import { describe, it, expect, vi, afterEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { platform } from '@tauri-apps/plugin-os'
import { api } from './tauri'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn() }))

afterEach(() => vi.clearAllMocks())

describe('api.git token threading', () => {
  it('omits token on desktop for pushNotes', async () => {
    vi.mocked(platform).mockReturnValue('windows')
    vi.mocked(invoke).mockResolvedValue('Pushed')

    await api.git.pushNotes('/ws', 'notesOnly', false)

    expect(invoke).toHaveBeenCalledWith('push_notes', {
      workspace: '/ws',
      mode: 'notesOnly',
      allowCodeRepoPush: false,
    })
  })

  it('attaches the stored token on iOS for pushNotes', async () => {
    vi.mocked(platform).mockReturnValue('ios')
    vi.mocked(invoke).mockImplementation((cmd: string) =>
      cmd === 'get_git_token' ? Promise.resolve('ghp_abc') : Promise.resolve('Pushed'),
    )

    await api.git.pushNotes('/ws', 'notesOnly', false)

    expect(invoke).toHaveBeenCalledWith('push_notes', {
      workspace: '/ws',
      mode: 'notesOnly',
      allowCodeRepoPush: false,
      token: 'ghp_abc',
    })
  })

  it('attaches the stored token on iOS for fetchAndCompare', async () => {
    vi.mocked(platform).mockReturnValue('ios')
    vi.mocked(invoke).mockImplementation((cmd: string) =>
      cmd === 'get_git_token' ? Promise.resolve('ghp_abc') : Promise.resolve('UpToDate'),
    )

    await api.git.fetchAndCompare('/ws')

    expect(invoke).toHaveBeenCalledWith('fetch_and_compare', { workspace: '/ws', token: 'ghp_abc' })
  })

  it('attaches the stored token on iOS for cloneRepo', async () => {
    vi.mocked(platform).mockReturnValue('ios')
    vi.mocked(invoke).mockImplementation((cmd: string) =>
      cmd === 'get_git_token' ? Promise.resolve('ghp_abc') : Promise.resolve('/Documents/notes'),
    )

    await api.git.cloneRepo('https://example.com/notes.git', '/Documents')

    expect(invoke).toHaveBeenCalledWith('clone_repo', {
      url: 'https://example.com/notes.git',
      parentDir: '/Documents',
      token: 'ghp_abc',
    })
  })
})
