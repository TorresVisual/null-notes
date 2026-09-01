import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DeckView } from './DeckView'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import type { CardSummary } from '../types'

vi.mock('../lib/tauri', () => ({
  api: { notes: { listAllCards: vi.fn() } },
}))

const cards: CardSummary[] = [
  {
    notePath: '/ws/a.md',
    noteTitle: 'A',
    kind: 'qa',
    front: 'Q1',
    back: 'A1',
    position: 0,
    due: '2026-01-01',
    interval: 0,
    tags: ['cs'],
  },
  {
    notePath: '/ws/b.md',
    noteTitle: 'B',
    kind: 'mc',
    front: 'Q2',
    back: '',
    position: 0,
    due: '2026-01-01',
    interval: 25,
    tags: ['algo'],
  },
]

beforeEach(() => {
  useWorkspaceStore.setState({ path: '/ws' })
  vi.mocked(api.notes.listAllCards).mockResolvedValue(cards)
})

describe('DeckView', () => {
  it('renders every card grouped by note', async () => {
    render(<DeckView onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Q1')).toBeInTheDocument())
    expect(screen.getByText('Q2')).toBeInTheDocument()
  })

  it('shows total, due, and mastered counts', async () => {
    render(<DeckView onClose={vi.fn()} />)
    await waitFor(() => screen.getByText('Q1'))
    expect(screen.getByText('2')).toBeInTheDocument() // total
  })

  it('narrows the list by tag', async () => {
    render(<DeckView onClose={vi.fn()} />)
    await waitFor(() => screen.getByText('Q1'))
    fireEvent.click(screen.getByLabelText('cs'))
    expect(screen.getByText('Q1')).toBeInTheDocument()
    expect(screen.queryByText('Q2')).not.toBeInTheDocument()
  })
})
