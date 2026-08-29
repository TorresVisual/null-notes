import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { BacklinksPanel } from './BacklinksPanel'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'

vi.mock('../lib/tauri', () => ({
  api: {
    notes: {
      backlinksForWithContext: vi.fn(),
    },
  },
}))

const backlinksForWithContext = vi.mocked(api.notes.backlinksForWithContext)

beforeEach(() => {
  backlinksForWithContext.mockReset()
  useWorkspaceStore.setState({ path: '/ws' })
})

describe('BacklinksPanel', () => {
  it('shows the context snippet alongside the linking note title', async () => {
    backlinksForWithContext.mockResolvedValue([
      {
        note: { id: '1', title: 'Dijkstra', path: '/ws/dijkstra.md', workspace: '/ws', updatedAt: 0 },
        snippet: 'Shortest paths with [[Big O Notation]] bounds.',
      },
    ])

    render(<BacklinksPanel notePath="/ws/big-o.md" noteTitle="Big O Notation" />)

    await waitFor(() => expect(screen.getByText('Dijkstra')).toBeInTheDocument())
    expect(screen.getByText('Shortest paths with [[Big O Notation]] bounds.')).toBeInTheDocument()
  })

  it('shows the note title alone when no snippet was found', async () => {
    backlinksForWithContext.mockResolvedValue([
      {
        note: { id: '1', title: 'Dijkstra', path: '/ws/dijkstra.md', workspace: '/ws', updatedAt: 0 },
        snippet: null,
      },
    ])

    render(<BacklinksPanel notePath="/ws/big-o.md" noteTitle="Big O Notation" />)

    await waitFor(() => expect(screen.getByText('Dijkstra')).toBeInTheDocument())
    expect(screen.queryByText('null')).not.toBeInTheDocument()
  })

  it('shows the empty state when nothing links here', async () => {
    backlinksForWithContext.mockResolvedValue([])

    render(<BacklinksPanel notePath="/ws/big-o.md" noteTitle="Big O Notation" />)

    await waitFor(() => expect(screen.getByText('No notes link here yet.')).toBeInTheDocument())
  })
})
