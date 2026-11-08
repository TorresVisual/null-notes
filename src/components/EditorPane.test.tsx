import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { EditorPane, type EditorPaneProps } from './EditorPane'

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(vi.fn()) }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: vi.fn(), message: vi.fn(), open: vi.fn() }))
vi.mock('../lib/tauri', () => ({
  api: {
    notes: {
      backlinksFor: vi.fn().mockResolvedValue([]),
      backlinksForWithContext: vi.fn().mockResolvedValue([]),
      unlinkedMentionsForWithContext: vi.fn().mockResolvedValue([]),
    },
    git: { listNoteHistory: vi.fn().mockResolvedValue([]) },
    pdf: { findPage: vi.fn().mockResolvedValue(null) },
  },
}))

const props = (notePath: string, content: string): EditorPaneProps => ({
  notePath,
  content,
  isLoading: false,
  saveState: 'clean',
  saveError: null,
  onSave: vi.fn(),
  onRetrySave: vi.fn(),
  onDismissSaveError: vi.fn(),
  conflict: false,
  onKeepMine: vi.fn(),
  onReloadTheirs: vi.fn(),
  viewMode: 'wysiwyg',
  onFlashcardCommand: vi.fn(),
})

describe('EditorPane', () => {
  afterEach(cleanup)

  it('mounts a fresh editor when the pane switches to another note', () => {
    // A buffer already loaded by the other group makes isLoading false on the
    // switch, so nothing else would remount the editor. Reusing it would put
    // the switch into undo history, and undoing it saves one note's text into
    // the other file.
    const { container, rerender } = render(<EditorPane {...props('/ws/a.md', 'alpha')} />)
    const before = container.querySelector('.ProseMirror')
    expect(before).not.toBeNull()

    rerender(<EditorPane {...props('/ws/b.md', 'beta')} />)

    const after = container.querySelector('.ProseMirror')
    expect(after).not.toBeNull()
    expect(after).not.toBe(before)
    expect(after?.textContent).toBe('beta')
  })
})
