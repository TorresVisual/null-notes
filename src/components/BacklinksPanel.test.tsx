import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BacklinksPanel } from './BacklinksPanel'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'
import { takePendingHighlight } from '../lib/pendingHighlight'

vi.mock('../lib/tauri', () => ({
  api: {
    notes: {
      backlinksForWithContext: vi.fn(),
      unlinkedMentionsForWithContext: vi.fn(),
    },
  },
}))

const backlinksForWithContext = vi.mocked(api.notes.backlinksForWithContext)
const unlinkedMentionsForWithContext = vi.mocked(api.notes.unlinkedMentionsForWithContext)

beforeEach(() => {
  backlinksForWithContext.mockReset()
  unlinkedMentionsForWithContext.mockReset()
  unlinkedMentionsForWithContext.mockResolvedValue([])
  useWorkspaceStore.setState({ path: '/ws', openTabs: [], activeTab: null })
})

describe('BacklinksPanel', () => {
  it('starts collapsed', async () => {
    backlinksForWithContext.mockResolvedValue([
      {
        note: { id: '1', title: 'Dijkstra', path: '/ws/dijkstra.md', workspace: '/ws', updatedAt: 0 },
        snippet: null,
      },
    ])

    render(<BacklinksPanel notePath="/ws/big-o.md" noteTitle="Big O Notation" />)

    await waitFor(() => expect(backlinksForWithContext).toHaveBeenCalled())
    expect(screen.queryByText('Dijkstra')).not.toBeInTheDocument()
  })

  it('shows the context snippet alongside the linking note title once expanded', async () => {
    const user = userEvent.setup()
    backlinksForWithContext.mockResolvedValue([
      {
        note: { id: '1', title: 'Dijkstra', path: '/ws/dijkstra.md', workspace: '/ws', updatedAt: 0 },
        snippet: 'Shortest paths with [[Big O Notation]] bounds.',
      },
    ])

    render(<BacklinksPanel notePath="/ws/big-o.md" noteTitle="Big O Notation" />)
    await user.click(await screen.findByRole('button', { name: /Linked from/ }))

    await waitFor(() => expect(screen.getByText('Dijkstra')).toBeInTheDocument())
    expect(screen.getByText('Shortest paths with [[Big O Notation]] bounds.')).toBeInTheDocument()
  })

  it('shows the note title alone when no snippet was found', async () => {
    const user = userEvent.setup()
    backlinksForWithContext.mockResolvedValue([
      {
        note: { id: '1', title: 'Dijkstra', path: '/ws/dijkstra.md', workspace: '/ws', updatedAt: 0 },
        snippet: null,
      },
    ])

    render(<BacklinksPanel notePath="/ws/big-o.md" noteTitle="Big O Notation" />)
    await user.click(await screen.findByRole('button', { name: /Linked from/ }))

    await waitFor(() => expect(screen.getByText('Dijkstra')).toBeInTheDocument())
    expect(screen.queryByText('null')).not.toBeInTheDocument()
  })

  it('shows the empty state when nothing links here', async () => {
    const user = userEvent.setup()
    backlinksForWithContext.mockResolvedValue([])

    render(<BacklinksPanel notePath="/ws/big-o.md" noteTitle="Big O Notation" />)
    await user.click(await screen.findByRole('button', { name: /Linked from/ }))

    await waitFor(() => expect(screen.getByText('No notes link here yet.')).toBeInTheDocument())
  })

  it('shows the empty state when nothing mentions this note unlinked', async () => {
    const user = userEvent.setup()
    backlinksForWithContext.mockResolvedValue([])

    render(<BacklinksPanel notePath="/ws/big-o.md" noteTitle="Big O Notation" />)
    await user.click(await screen.findByRole('button', { name: /Unlinked mentions/ }))

    await waitFor(() => expect(screen.getByText('No unlinked mentions found.')).toBeInTheDocument())
  })

  it('shows the context snippet for an unlinked mention once expanded', async () => {
    const user = userEvent.setup()
    backlinksForWithContext.mockResolvedValue([])
    unlinkedMentionsForWithContext.mockResolvedValue([
      {
        note: { id: '2', title: 'Sorting', path: '/ws/sorting.md', workspace: '/ws', updatedAt: 0 },
        snippet: 'Big O Notation describes the worst case here.',
      },
    ])

    render(<BacklinksPanel notePath="/ws/big-o.md" noteTitle="Big O Notation" />)
    await user.click(await screen.findByRole('button', { name: /Unlinked mentions/ }))

    await waitFor(() => expect(screen.getByText('Sorting')).toBeInTheDocument())
    expect(
      screen.getByText('Big O Notation describes the worst case here.'),
    ).toBeInTheDocument()
  })

  it('opens the mentioning note and stashes a pending highlight when clicked', async () => {
    const user = userEvent.setup()
    backlinksForWithContext.mockResolvedValue([])
    unlinkedMentionsForWithContext.mockResolvedValue([
      {
        note: { id: '2', title: 'Sorting', path: '/ws/sorting.md', workspace: '/ws', updatedAt: 0 },
        snippet: null,
      },
    ])

    render(<BacklinksPanel notePath="/ws/big-o.md" noteTitle="Big O Notation" />)
    await user.click(await screen.findByRole('button', { name: /Unlinked mentions/ }))
    await user.click(await screen.findByRole('button', { name: 'Sorting' }))

    expect(useWorkspaceStore.getState().activeTab).toBe('/ws/sorting.md')
    expect(takePendingHighlight('/ws/sorting.md')).toBe('Big O Notation')
  })
})
