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
    expect(recentSection.contains(buttons[0])).toBe(true)
    expect(buttons[0]).toHaveTextContent('Newer')
    expect(buttons[1]).toHaveTextContent('Older')

    await userEvent.click(getByText('Newer'))
    expect(useWorkspaceStore.getState().openTabs).toContain('/ws/newer.md')
    expect(useWorkspaceStore.getState().activeTab).toBe('/ws/newer.md')
  })
})
