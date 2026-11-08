import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react'
import { EditorGroups } from './EditorGroups'
import { TooltipProvider } from './ui/tooltip'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { initialLayout } from '../lib/editorGroups'

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
vi.mock('../hooks/useNote', () => ({
  useNote: vi.fn(() => ({
    content: '',
    save: vi.fn(),
    isLoading: false,
    saveState: 'clean',
    saveError: null,
    flush: vi.fn().mockResolvedValue(undefined),
    retrySave: vi.fn(),
    dismissError: vi.fn(),
    conflict: false,
    keepMine: vi.fn(),
    reloadTheirs: vi.fn(),
  })),
}))

const A = '/ws/a.md'
const B = '/ws/b.md'

const status = {
  saveState: 'clean' as const,
  saveError: null,
  onRetrySave: vi.fn(),
  onDismissSaveError: vi.fn(),
  gitCommitStatus: 'idle' as const,
  gitCommitDetail: null,
  onSyncNow: vi.fn(),
  syncingNow: false,
}

function renderGroups() {
  return render(
    <TooltipProvider>
      <EditorGroups
        status={status}
        exportPaneRef={{ current: null }}
        outlineOpen={false}
        outgoingLinksOpen={false}
        onFlashcardCommand={vi.fn()}
        onDiagramCommand={vi.fn()}
        emptyState={{
          onOpenTaskView: vi.fn(),
          onOpenReview: vi.fn(),
          onOpenDeckView: vi.fn(),
          onOpenSettings: vi.fn(),
          overlayOpen: false,
        }}
      />
    </TooltipProvider>,
  )
}

const st = () => useWorkspaceStore.getState()

beforeEach(() => {
  useWorkspaceStore.setState({
    path: '/ws',
    openTabs: [],
    pinnedTabs: [],
    activeTab: null,
    layout: initialLayout(),
    repoMode: null,
  })
  useNotesStore.setState({
    notes: [A, B].map((path) => ({ id: path, path, title: path.slice(4, 5), workspace: '/ws', updatedAt: 0 })),
    folders: [],
    tags: [],
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('EditorGroups', () => {
  it('renders one tab bar and no divider with a single group', () => {
    st().openTab(A)
    renderGroups()
    expect(screen.getAllByRole('tablist')).toHaveLength(1)
    expect(screen.queryByRole('separator')).toBeNull()
  })

  it('renders two tab bars with independent tab lists and a Source toggle each after a split', () => {
    st().openTab(A)
    st().openTab(B)
    st().splitEditor('right')
    st().openTab(A)
    renderGroups()

    const bars = screen.getAllByRole('tablist')
    expect(bars).toHaveLength(2)
    expect(within(bars[0] as HTMLElement).getAllByRole('tab').map((t) => t.textContent)).toEqual(['a', 'b'])
    expect(within(bars[1] as HTMLElement).getAllByRole('tab').map((t) => t.textContent)).toEqual(['b', 'a'])
    expect(screen.getAllByRole('button', { name: 'Source' })).toHaveLength(2)
    expect(screen.getByRole('separator')).toBeInTheDocument()
  })

  it('focuses the group that receives a mousedown', () => {
    st().openTab(A)
    st().splitEditor('right')
    st().focusGroup(0)
    renderGroups()

    const groups = document.querySelectorAll('.editor-group')
    fireEvent.mouseDown(groups[1] as HTMLElement)
    expect(st().layout.focused).toBe(1)
    expect(groups[1]).toHaveClass('editor-group--focused')
    expect(groups[0]).not.toHaveClass('editor-group--focused')
  })

  it('shows the sync controls only in the first group’s bar', () => {
    useWorkspaceStore.setState({ repoMode: 'notesOnly' })
    st().openTab(A)
    st().splitEditor('right')
    renderGroups()
    expect(screen.getAllByText('Sync now')).toHaveLength(1)
    const firstBar = document.querySelectorAll('.editor-group')[0] as HTMLElement
    expect(within(firstBar).getByText('Sync now')).toBeInTheDocument()
  })

  it('a tab click in the other group activates it there and focuses that group', () => {
    st().openTab(A)
    st().openTab(B)
    st().splitEditor('right')
    st().focusGroup(0)
    renderGroups()

    const bars = screen.getAllByRole('tablist')
    act(() => {
      fireEvent.click(within(bars[1] as HTMLElement).getByRole('tab', { name: 'b' }))
    })
    expect(st().layout.focused).toBe(1)
    expect(st().activeTab).toBe(B)
  })
})
