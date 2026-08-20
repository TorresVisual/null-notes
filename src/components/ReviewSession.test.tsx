import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ReviewSession } from './ReviewSession'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import type { DueCard } from '../types'

vi.mock('../lib/tauri', () => ({
  api: {
    notes: {
      listDueCards: vi.fn(),
      gradeCard: vi.fn(),
    },
  },
}))

const cards: DueCard[] = [
  { notePath: '/ws/a.md', noteTitle: 'A', kind: 'qa', front: 'Q1', back: 'A1', position: 0 },
  { notePath: '/ws/b.md', noteTitle: 'B', kind: 'cloze', front: 'Q2 [...]', back: 'Q2 full', position: 3 },
]

beforeEach(() => {
  useWorkspaceStore.setState({ path: '/ws' })
  vi.mocked(api.notes.listDueCards).mockResolvedValue(cards)
  vi.mocked(api.notes.gradeCard).mockResolvedValue(undefined)
})

describe('ReviewSession', () => {
  it('shows the front of the first due card, answer hidden', async () => {
    render(<ReviewSession onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Q1')).toBeInTheDocument())
    expect(screen.queryByText('A1')).not.toBeInTheDocument()
    expect(screen.getByText('Reveal answer')).toBeInTheDocument()
  })

  it('reveals the back and grade buttons on click', async () => {
    render(<ReviewSession onClose={vi.fn()} />)
    await waitFor(() => screen.getByText('Q1'))
    fireEvent.click(screen.getByText('Reveal answer'))
    expect(screen.getByText('A1')).toBeInTheDocument()
    expect(screen.getByText('Again')).toBeInTheDocument()
    expect(screen.getByText('Hard')).toBeInTheDocument()
    expect(screen.getByText('Good')).toBeInTheDocument()
    expect(screen.getByText('Easy')).toBeInTheDocument()
  })

  it('grades the card and advances to the next one', async () => {
    render(<ReviewSession onClose={vi.fn()} />)
    await waitFor(() => screen.getByText('Q1'))
    fireEvent.click(screen.getByText('Reveal answer'))
    fireEvent.click(screen.getByText('Good'))

    expect(api.notes.gradeCard).toHaveBeenCalledWith('/ws/a.md', 0, 'good', '/ws')
    await waitFor(() => expect(screen.getByText('Q2 [...]')).toBeInTheDocument())
    expect(screen.queryByText('Reveal answer')).toBeInTheDocument()
  })

  it('shows "all done" once the queue is empty', async () => {
    vi.mocked(api.notes.listDueCards).mockResolvedValue([])
    render(<ReviewSession onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/all done/i)).toBeInTheDocument())
  })
})
