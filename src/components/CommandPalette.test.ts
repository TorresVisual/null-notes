import { describe, it, expect, vi } from 'vitest'
import { platform } from '@tauri-apps/plugin-os'
import { availableActions } from './CommandPalette'

vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn(() => 'windows') }))

const ids = (ctx: Parameters<typeof availableActions>[0]) => availableActions(ctx).map((a) => a.id)

describe('availableActions', () => {
  it('offers only workspace-independent actions with no workspace', () => {
    expect(ids({ hasWorkspace: false, hasNote: false, repoMode: false }).sort()).toEqual([
      'exit',
      'open-workspace',
      'settings',
      'shortcuts-help',
    ])
  })

  it('hides note-bound actions until a note is open', () => {
    expect(ids({ hasWorkspace: true, hasNote: false, repoMode: false })).not.toContain('export-pdf')
    expect(ids({ hasWorkspace: true, hasNote: true, repoMode: false })).toContain('export-pdf')
    expect(ids({ hasWorkspace: true, hasNote: false, repoMode: false })).not.toContain('note-duplicate')
    expect(ids({ hasWorkspace: true, hasNote: true, repoMode: false })).toContain('note-duplicate')
  })

  it('offers New Agent Canvas whenever a workspace is open', () => {
    expect(ids({ hasWorkspace: true, hasNote: false, repoMode: false })).toContain('new-agent-canvas')
    expect(ids({ hasWorkspace: false, hasNote: false, repoMode: false })).not.toContain('new-agent-canvas')
  })

  it('hides window and keyboard commands on mobile', () => {
    vi.mocked(platform).mockReturnValue('android')
    const mobile = ids({ hasWorkspace: true, hasNote: true, repoMode: false })
    expect(mobile).toContain('note-duplicate')
    for (const id of ['split-editor', 'zoom-in', 'close-tab', 'goto-tab:1', 'note-reveal', 'exit']) {
      expect(mobile).not.toContain(id)
    }
    vi.mocked(platform).mockReturnValue('windows')
    expect(ids({ hasWorkspace: true, hasNote: true, repoMode: false })).toContain('split-editor')
  })

  it('shows Sync Now only in a git repo, and never lists the palette itself', () => {
    expect(ids({ hasWorkspace: true, hasNote: true, repoMode: false })).not.toContain('sync-now')
    const withRepo = ids({ hasWorkspace: true, hasNote: true, repoMode: true })
    expect(withRepo).toContain('sync-now')
    expect(withRepo).not.toContain('command-palette')
  })
})
