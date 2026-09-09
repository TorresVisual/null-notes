import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ReviewSession } from './ReviewSession'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import type { DueCard } from '../types'

vi.mock('../lib/tauri', () => ({
  api: {
    notes: {
      listDueCards: vi.fn(),
      listCramCards: vi.fn(),
      gradeCard: vi.fn(),
      gradeMcCard: vi.fn(),
    },
  },
}))

const cards: DueCard[] = [
  { notePath: '/ws/a.md', noteTitle: 'A', kind: 'qa', front: 'Q1', back: 'A1', position: 0, options: [], streak: 0 },
  { notePath: '/ws/b.md', noteTitle: 'B', kind: 'cloze', front: 'Q2 [...]', back: 'Q2 full', position: 3, options: [], streak: 0 },
]

const mcCard: DueCard = {
  notePath: '/ws/c.md',
  noteTitle: 'C',
  kind: 'mc',
  front: 'What is 2+2?',
  back: '',
  position: 0,
  options: ['3', '4', '5'],
  streak: 0,
}

beforeEach(() => {
  useWorkspaceStore.setState({ path: '/ws', gitPendingPaths: [] })
  vi.mocked(api.notes.listDueCards).mockResolvedValue(cards)
  vi.mocked(api.notes.gradeCard).mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
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

  it('grades the card, re-fetches the queue, and advances to the next card', async () => {
    // Grading can shift a later card's line position within the same note
    // (a schedule comment is inserted), so the session re-fetches the whole
    // due queue after each grade rather than trusting the cached list. The
    // mock tracks graded state itself (rather than queuing fixed return
    // values by call order) so it stays correct regardless of exactly how
    // many times an effect re-fires a fetch.
    let graded = false
    vi.mocked(api.notes.listDueCards).mockImplementation(async () => (graded ? [cards[1]!] : cards))
    vi.mocked(api.notes.gradeCard).mockImplementation(async () => {
      graded = true
    })

    render(<ReviewSession onClose={vi.fn()} />)
    await waitFor(() => screen.getByText('Q1'))
    fireEvent.click(screen.getByText('Reveal answer'))
    fireEvent.click(screen.getByText('Good'))

    expect(api.notes.gradeCard).toHaveBeenCalledWith('/ws/a.md', 0, 'good', '/ws')
    await waitFor(() => expect(screen.getByText('Q2 [...]')).toBeInTheDocument())
    expect(screen.queryByText('Reveal answer')).toBeInTheDocument()
  })

  it('queues the graded note for auto-commit, like a normal save does', async () => {
    render(<ReviewSession onClose={vi.fn()} />)
    await waitFor(() => screen.getByText('Q1'))
    fireEvent.click(screen.getByText('Reveal answer'))
    fireEvent.click(screen.getByText('Good'))

    await waitFor(() => expect(useWorkspaceStore.getState().gitPendingPaths).toContain('/ws/a.md'))
  })

  it('does not queue the note for auto-commit when grading fails', async () => {
    vi.mocked(api.notes.gradeCard).mockRejectedValue(new Error('note deleted'))
    render(<ReviewSession onClose={vi.fn()} />)
    await waitFor(() => screen.getByText('Q1'))
    fireEvent.click(screen.getByText('Reveal answer'))
    fireEvent.click(screen.getByText('Good'))

    await waitFor(() => expect(api.notes.gradeCard).toHaveBeenCalled())
    expect(useWorkspaceStore.getState().gitPendingPaths).not.toContain('/ws/a.md')
  })

  it('shows "all done" once the queue is empty', async () => {
    vi.mocked(api.notes.listDueCards).mockResolvedValue([])
    render(<ReviewSession onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/all done/i)).toBeInTheDocument())
  })
})

describe('ReviewSession — multiple choice', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ path: '/ws', gitPendingPaths: [] })
    vi.mocked(api.notes.listDueCards).mockResolvedValue([mcCard])
  })

  it('renders options as checkboxes with Submit disabled until a pick', async () => {
    render(<ReviewSession onClose={vi.fn()} />)
    await waitFor(() => screen.getByText('What is 2+2?'))
    expect(screen.getByText('Submit')).toBeDisabled()
    fireEvent.click(screen.getByLabelText('4'))
    expect(screen.getByText('Submit')).not.toBeDisabled()
  })

  it('randomizes the displayed option order while keeping each choice gradeable', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    vi.mocked(api.notes.gradeMcCard).mockResolvedValue({ correct: [1] })
    render(<ReviewSession onClose={vi.fn()} />)

    await waitFor(() => screen.getByText('What is 2+2?'))
    expect(screen.getAllByRole('checkbox').map((input) => input.getAttribute('aria-label'))).toEqual(['4', '5', '3'])

    fireEvent.click(screen.getByLabelText('4'))
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => expect(api.notes.gradeMcCard).toHaveBeenCalledWith('/ws/c.md', 0, [1], '/ws'))
  })

  it('submits picked options and highlights correct/incorrect after grading', async () => {
    vi.mocked(api.notes.gradeMcCard).mockResolvedValue({ correct: [1] })
    render(<ReviewSession onClose={vi.fn()} />)
    await waitFor(() => screen.getByText('What is 2+2?'))
    fireEvent.click(screen.getByLabelText('3'))
    fireEvent.click(screen.getByText('Submit'))

    await waitFor(() => expect(api.notes.gradeMcCard).toHaveBeenCalledWith('/ws/c.md', 0, [0], '/ws'))
    expect(screen.getByLabelText('3').closest('li')).toHaveClass('review-card-option-incorrect')
    expect(screen.getByLabelText('4').closest('li')).toHaveClass('review-card-option-missed')
    expect(screen.getByText('Next')).toBeInTheDocument()
    expect(screen.getByLabelText('3')).toBeDisabled()
  })

  it('queues the note for auto-commit after a multiple-choice grade', async () => {
    vi.mocked(api.notes.gradeMcCard).mockResolvedValue({ correct: [1] })
    render(<ReviewSession onClose={vi.fn()} />)
    await waitFor(() => screen.getByText('What is 2+2?'))
    fireEvent.click(screen.getByLabelText('4'))
    fireEvent.click(screen.getByText('Submit'))

    await waitFor(() => expect(useWorkspaceStore.getState().gitPendingPaths).toContain('/ws/c.md'))
  })

  it('Next re-fetches the due queue', async () => {
    vi.mocked(api.notes.gradeMcCard).mockResolvedValue({ correct: [1] })
    let refetched = false
    vi.mocked(api.notes.listDueCards).mockImplementation(async () => (refetched ? [] : [mcCard]))
    render(<ReviewSession onClose={vi.fn()} />)
    await waitFor(() => screen.getByText('What is 2+2?'))
    fireEvent.click(screen.getByLabelText('4'))
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => screen.getByText('Next'))
    refetched = true
    fireEvent.click(screen.getByText('Next'))
    await waitFor(() => expect(screen.getByText(/all done/i)).toBeInTheDocument())
  })
})

describe('ReviewSession — cram mode', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ path: '/ws' })
    vi.mocked(api.notes.listDueCards).mockClear()
    vi.mocked(api.notes.listCramCards).mockResolvedValue(cards)
  })

  it('fetches from listCramCards with the given streak, not listDueCards', async () => {
    render(<ReviewSession onClose={vi.fn()} mode={{ kind: 'cram', streak: 2 }} />)
    await waitFor(() => expect(api.notes.listCramCards).toHaveBeenCalledWith('/ws', 2))
    expect(api.notes.listDueCards).not.toHaveBeenCalled()
  })

  it('shows the cram header with cards remaining instead of the due-queue header', async () => {
    render(<ReviewSession onClose={vi.fn()} mode={{ kind: 'cram', streak: 2 }} />)
    await waitFor(() => expect(screen.getByText('Cram — Category 2 (2 left)')).toBeInTheDocument())
  })

  it('shows the cram-specific empty state when the category has no cards', async () => {
    vi.mocked(api.notes.listCramCards).mockResolvedValue([])
    render(<ReviewSession onClose={vi.fn()} mode={{ kind: 'cram', streak: 2 }} />)
    await waitFor(() => expect(screen.getByText('No cards in this category.')).toBeInTheDocument())
  })

  it('shuffles without dropping any fetched card', async () => {
    render(<ReviewSession onClose={vi.fn()} mode={{ kind: 'cram', streak: 2 }} />)
    await waitFor(() => {
      const front = screen.queryByText('Q1') ?? screen.queryByText('Q2 [...]')
      expect(front).toBeInTheDocument()
    })
  })
})
