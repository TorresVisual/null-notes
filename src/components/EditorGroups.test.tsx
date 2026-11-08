import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
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

  it('moves the caret into the group that a keyboard command focuses', () => {
    st().openTab(A)
    st().splitEditor('right')
    renderGroups()
    const groups = document.querySelectorAll('.editor-group')

    act(() => st().focusPrevGroup())
    expect(groups[0]?.contains(document.activeElement)).toBe(true)

    act(() => st().focusNextGroup())
    expect(groups[1]?.contains(document.activeElement)).toBe(true)
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

describe('EditorGroups divider', () => {
  function renderSplit(direction: 'row' | 'column' = 'row') {
    st().openTab(A)
    st().splitEditor(direction === 'row' ? 'right' : 'down')
    renderGroups()
    return screen.getByRole('separator')
  }

  it('exposes its range and one tab stop', () => {
    const divider = renderSplit()
    expect(divider).toHaveAttribute('tabindex', '0')
    expect(divider).toHaveAttribute('aria-valuemin', '20')
    expect(divider).toHaveAttribute('aria-valuemax', '80')
    expect(divider).toHaveAttribute('aria-valuenow', '50')
  })

  it('resets to 50/50 on double-click', () => {
    const divider = renderSplit()
    act(() => st().setSplitRatio(0.3))
    fireEvent.doubleClick(divider)
    expect(st().layout.ratio).toBe(0.5)
  })

  it('moves 5% per arrow key along its own axis', () => {
    const row = renderSplit()
    fireEvent.keyDown(row, { key: 'ArrowRight' })
    expect(st().layout.ratio).toBeCloseTo(0.55)
    fireEvent.keyDown(row, { key: 'ArrowLeft' })
    fireEvent.keyDown(row, { key: 'ArrowLeft' })
    expect(st().layout.ratio).toBeCloseTo(0.45)
  })

  it('uses Up and Down in a stacked layout', () => {
    const column = renderSplit('column')
    fireEvent.keyDown(column, { key: 'ArrowDown' })
    expect(st().layout.ratio).toBeCloseTo(0.55)
    fireEvent.keyDown(column, { key: 'ArrowRight' })
    expect(st().layout.ratio).toBeCloseTo(0.55)
  })

  it('never goes past 20% or 80%, and Home and End jump to them', () => {
    const divider = renderSplit()
    for (let i = 0; i < 12; i++) fireEvent.keyDown(divider, { key: 'ArrowLeft' })
    expect(st().layout.ratio).toBeCloseTo(0.2)
    fireEvent.keyDown(divider, { key: 'End' })
    expect(st().layout.ratio).toBeCloseTo(0.8)
    for (let i = 0; i < 12; i++) fireEvent.keyDown(divider, { key: 'ArrowRight' })
    expect(st().layout.ratio).toBeCloseTo(0.8)
    fireEvent.keyDown(divider, { key: 'Home' })
    expect(st().layout.ratio).toBeCloseTo(0.2)
  })
})

describe('EditorGroups tab drops', () => {
  const TAB_MIME = 'application/x-nullnotes-tab'

  // jsdom has no DragEvent, so testing-library would build a plain Event and
  // drop clientX/clientY/ctrlKey, which is exactly what these tests need.
  beforeAll(() => {
    if (!('DragEvent' in window)) {
      Object.defineProperty(window, 'DragEvent', { configurable: true, value: class extends MouseEvent {} })
    }
  })

  function dropData(path: string, types: string[] = [TAB_MIME, 'text/plain']) {
    return { types, getData: () => path, dropEffect: 'move' }
  }

  function dropOnGroup(index: number, path: string, at: { x: number; y: number }, init: object = {}, types?: string[]) {
    const group = document.querySelectorAll('.editor-group')[index] as HTMLElement
    fireEvent.drop(group, { clientX: at.x, clientY: at.y, dataTransfer: dropData(path, types), ...init })
  }

  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800, x: 0, y: 0, toJSON: () => ({}),
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it('splits when a tab is dropped on the left edge of a single group, new group first', () => {
    st().openTab(A)
    st().openTab(B)
    renderGroups()

    dropOnGroup(0, A, { x: 40, y: 500 })

    expect(st().layout.groups).toHaveLength(2)
    expect(st().layout.groups[0]?.tabs).toEqual([A])
    expect(st().layout.groups[1]?.tabs).toEqual([A, B])
    expect(st().layout.focused).toBe(0)
  })

  it('moves a tab into the other group when dropped on its body', () => {
    st().openTab(A)
    st().openTab(B)
    st().splitEditor('right')
    renderGroups()

    dropOnGroup(1, A, { x: 700, y: 500 })

    expect(st().layout.groups[0]?.tabs).toEqual([B])
    expect(st().layout.groups[1]?.tabs).toEqual([B, A])
    expect(st().layout.focused).toBe(1)
  })

  it('copies instead of moving when Ctrl is held', () => {
    st().openTab(A)
    st().openTab(B)
    st().splitEditor('right')
    renderGroups()

    dropOnGroup(1, A, { x: 700, y: 500 }, { ctrlKey: true })

    expect(st().layout.groups[0]?.tabs).toEqual([A, B])
    expect(st().layout.groups[1]?.tabs).toEqual([B, A])
  })

  it('never splits a canvas into a new group', () => {
    st().openTab(A)
    st().openTab('/ws/map.canvas')
    renderGroups()

    dropOnGroup(0, '/ws/map.canvas', { x: 960, y: 500 })

    expect(st().layout.groups).toHaveLength(1)
  })

  it('ignores a drag that is not a tab, such as selected text', () => {
    st().openTab(A)
    renderGroups()

    dropOnGroup(0, A, { x: 960, y: 500 }, {}, ['text/plain'])

    expect(st().layout.groups).toHaveLength(1)
  })

  it('shows an edge highlight while a tab is dragged over a single group', () => {
    st().openTab(A)
    renderGroups()
    const group = document.querySelector('.editor-group') as HTMLElement

    fireEvent.dragOver(group, { clientX: 960, clientY: 500, dataTransfer: dropData(A) })

    expect(document.querySelector('.split-drop-zone--right')).not.toBeNull()
    fireEvent.dragLeave(group, { relatedTarget: document.body })
    expect(document.querySelector('.split-drop-zone')).toBeNull()
  })
})
