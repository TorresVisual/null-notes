import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HomeView } from './HomeView'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { api } from '../lib/tauri'

vi.mock('../lib/tauri', () => ({
  api: {
    notes: { listOpenTasks: vi.fn() },
  },
}))

const listOpenTasks = vi.mocked(api.notes.listOpenTasks)

const resetWorkspace = () =>
  useWorkspaceStore.setState({
    path: '/ws',
    openTabs: [],
    activeTab: null,
    repoMode: null,
    gitDiverged: null,
    gitPendingPaths: [],
  })

beforeEach(() => {
  resetWorkspace()
  useNotesStore.setState({ notes: [], folders: [], tags: [] })
  listOpenTasks.mockResolvedValue([])
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('HomeView', () => {
  it('lists open tabs under Continue, most-recently-opened first, and activates one on click', async () => {
    useWorkspaceStore.getState().openTab('/ws/a.md')
    useWorkspaceStore.getState().openTab('/ws/b.md')

    const { getByText } = render(<HomeView onOpenTaskView={() => {}} />)

    const items = [getByText('a'), getByText('b')]
    expect(items[0]).toBeInTheDocument()
    expect(items[1]).toBeInTheDocument()

    await userEvent.click(getByText('b'))
    expect(useWorkspaceStore.getState().activeTab).toBe('/ws/b.md')
    expect(useWorkspaceStore.getState().openTabs).toEqual(['/ws/a.md', '/ws/b.md'])
  })

  it('shows an empty hint under Continue when no tabs are open', () => {
    const { getByText } = render(<HomeView onOpenTaskView={() => {}} />)
    expect(getByText('No open notes.')).toBeInTheDocument()
  })

  it('lists notes under Recent sorted by most recently updated, and opens one on click', async () => {
    useNotesStore.setState({
      notes: [
        { id: '1', title: 'Older', path: '/ws/older.md', workspace: '/ws', updatedAt: 1 },
        { id: '2', title: 'Newer', path: '/ws/newer.md', workspace: '/ws', updatedAt: 2 },
      ],
      folders: [],
      tags: [],
    })

    const { getByText, getAllByRole } = render(<HomeView onOpenTaskView={() => {}} />)
    const recentSection = getByText('Recent').closest('section')!
    const buttons = getAllByRole('button', { name: /Older|Newer/ })
    expect(buttons).toHaveLength(2)
    expect(recentSection.contains(buttons[0]!)).toBe(true)
    expect(buttons[0]).toHaveTextContent('Newer')
    expect(buttons[1]).toHaveTextContent('Older')

    await userEvent.click(getByText('Newer'))
    expect(useWorkspaceStore.getState().openTabs).toContain('/ws/newer.md')
    expect(useWorkspaceStore.getState().activeTab).toBe('/ws/newer.md')
  })

  it('shows an open-task count and preview list under Tasks, opening a note on click', async () => {
    listOpenTasks.mockResolvedValue([
      { notePath: '/ws/a.md', noteTitle: 'A', text: 'Finish proof', position: 0 },
      { notePath: '/ws/b.md', noteTitle: 'B', text: 'Review notes', position: 3 },
    ])

    const { findByText, getByText } = render(<HomeView onOpenTaskView={() => {}} />)

    expect(await findByText('2 open')).toBeInTheDocument()
    expect(getByText('Finish proof')).toBeInTheDocument()

    await userEvent.click(getByText('Finish proof'))
    expect(useWorkspaceStore.getState().openTabs).toContain('/ws/a.md')
  })

  it('shows an empty hint under Tasks when there are none', async () => {
    listOpenTasks.mockResolvedValue([])
    const { findByText } = render(<HomeView onOpenTaskView={() => {}} />)
    expect(await findByText('No open tasks.')).toBeInTheDocument()
  })

  it('opens the full task view from "View all"', async () => {
    listOpenTasks.mockResolvedValue([
      { notePath: '/ws/a.md', noteTitle: 'A', text: 'Finish proof', position: 0 },
    ])
    const onOpenTaskView = vi.fn()
    const { findByText, getByText } = render(<HomeView onOpenTaskView={onOpenTaskView} />)

    await findByText('Finish proof')
    await userEvent.click(getByText('View all'))
    expect(onOpenTaskView).toHaveBeenCalledOnce()
  })

  it('shows Study as a disabled placeholder', () => {
    const { getByText } = render(<HomeView onOpenTaskView={() => {}} />)
    expect(getByText("Spaced repetition isn't set up yet.")).toBeInTheDocument()
  })

  it('hides the Git section when the workspace is not a Git repo', () => {
    useWorkspaceStore.setState({ repoMode: null })
    const { queryByText } = render(<HomeView onOpenTaskView={() => {}} />)
    expect(queryByText('Git')).not.toBeInTheDocument()
  })

  it('shows "Up to date" when there is no divergence and nothing pending', () => {
    useWorkspaceStore.setState({ repoMode: 'notesOnly', gitDiverged: null, gitPendingPaths: [] })
    const { getByText } = render(<HomeView onOpenTaskView={() => {}} />)
    expect(getByText('Up to date')).toBeInTheDocument()
  })

  it('shows an unpushed count when paths are pending and there is no divergence', () => {
    useWorkspaceStore.setState({
      repoMode: 'notesOnly',
      gitDiverged: null,
      gitPendingPaths: ['/ws/a.md', '/ws/b.md'],
    })
    const { getByText } = render(<HomeView onOpenTaskView={() => {}} />)
    expect(getByText('2 unpushed')).toBeInTheDocument()
  })

  it('shows the ahead/behind count when diverged, taking priority over pending paths', () => {
    useWorkspaceStore.setState({
      repoMode: 'notesOnly',
      gitDiverged: { ahead: 1, behind: 3 },
      gitPendingPaths: ['/ws/a.md'],
    })
    const { getByText } = render(<HomeView onOpenTaskView={() => {}} />)
    expect(getByText('1 ahead, 3 behind')).toBeInTheDocument()
  })
})
