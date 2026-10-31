import { describe, it, expect } from 'vitest'
import { availableActions } from './CommandPalette'

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
  })

  it('shows Sync Now only in a git repo, and never lists the palette itself', () => {
    expect(ids({ hasWorkspace: true, hasNote: true, repoMode: false })).not.toContain('sync-now')
    const withRepo = ids({ hasWorkspace: true, hasNote: true, repoMode: true })
    expect(withRepo).toContain('sync-now')
    expect(withRepo).not.toContain('command-palette')
  })
})
