import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShortcutsOverlay } from './ShortcutsOverlay'
import { TaskView } from './TaskView'
import { GraphView } from './GraphView'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'

vi.mock('../lib/tauri', () => ({
  api: {
    notes: { listOpenTasks: vi.fn(), graphLinks: vi.fn(), graphTags: vi.fn() },
  },
}))

beforeEach(() => {
  useWorkspaceStore.setState({ path: '/ws' })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ShortcutsOverlay', () => {
  it('has a close button and a keyboard-focusable scroll region', async () => {
    const onClose = vi.fn()
    render(<ShortcutsOverlay onClose={onClose} />)

    expect(screen.getByRole('region', { name: 'Shortcut list' }).tabIndex).toBe(0)
    await userEvent.click(screen.getByRole('button', { name: 'Close shortcuts' }))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('TaskView', () => {
  it('is a labelled dialog and says so when the tasks fail to load', async () => {
    vi.mocked(api.notes.listOpenTasks).mockRejectedValue('disk gone')
    render(<TaskView onClose={() => {}} />)

    expect(screen.getByRole('dialog', { name: 'Tasks' })).toBeTruthy()
    expect(await screen.findByText("Couldn't load tasks.")).toBeTruthy()
    expect(screen.getByText('disk gone')).toBeTruthy()
  })
})

describe('GraphView', () => {
  it('says so instead of spinning forever when the graph fails to load', async () => {
    vi.mocked(api.notes.graphLinks).mockRejectedValue('index locked')
    vi.mocked(api.notes.graphTags).mockResolvedValue([])
    render(<GraphView onClose={() => {}} />)

    expect(screen.getByRole('dialog', { name: 'Connections' })).toBeTruthy()
    await waitFor(() => expect(screen.getByText("Couldn't load the graph.")).toBeTruthy())
  })
})
