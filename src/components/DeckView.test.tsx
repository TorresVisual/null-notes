import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DeckView } from './DeckView'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import type { CardSummary } from '../types'

vi.mock('../lib/tauri', () => ({
  api: { notes: { listAllCards: vi.fn(), setCardSuspended: vi.fn() } },
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
    streak: 0,
    lapses: 0,
    suspended: false,
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
    streak: 2,
    lapses: 0,
    suspended: false,
    tags: ['algo'],
  },
]

beforeEach(() => {
  useWorkspaceStore.setState({ path: '/ws' })
  vi.mocked(api.notes.listAllCards).mockResolvedValue(cards)
})

describe('DeckView', () => {
  it('renders every card grouped by note', async () => {
    render(<DeckView onClose={vi.fn()} onOpenCram={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Q1')).toBeInTheDocument())
    expect(screen.getByText('Q2')).toBeInTheDocument()
  })

  it('shows total, due, and mastered counts', async () => {
    render(<DeckView onClose={vi.fn()} onOpenCram={vi.fn()} />)
    await waitFor(() => screen.getByText('Q1'))
    expect(screen.getByText('2')).toBeInTheDocument() // total
  })

  it('narrows the list by tag', async () => {
    render(<DeckView onClose={vi.fn()} onOpenCram={vi.fn()} />)
    await waitFor(() => screen.getByText('Q1'))
    fireEvent.click(screen.getByLabelText('cs'))
    expect(screen.getByText('Q1')).toBeInTheDocument()
    expect(screen.queryByText('Q2')).not.toBeInTheDocument()
  })
})

describe('DeckView — cram categories', () => {
  it('shows one chip per streak value with correct counts, labeling streak 0 as New', async () => {
    render(<DeckView onClose={vi.fn()} onOpenCram={vi.fn()} />)
    await waitFor(() => screen.getByText('Q1'))
    expect(screen.getByText('New (1)')).toBeInTheDocument()
    expect(screen.getByText('Category 2 (1)')).toBeInTheDocument()
  })

  it('calls onOpenCram with the chip\'s streak value when Cram is clicked', async () => {
    const onOpenCram = vi.fn()
    render(<DeckView onClose={vi.fn()} onOpenCram={onOpenCram} />)
    await waitFor(() => screen.getByText('Category 2 (1)'))
    const chip = screen.getByText('Category 2 (1)').closest('.deck-view-category')
    if (!chip) throw new Error('chip not found')
    fireEvent.click(chip.querySelector('.deck-view-category-cram') as HTMLElement)
    expect(onOpenCram).toHaveBeenCalledWith(2, false)
  })

  it('respects the active tag filter', async () => {
    render(<DeckView onClose={vi.fn()} onOpenCram={vi.fn()} />)
    await waitFor(() => screen.getByText('Q1'))
    fireEvent.click(screen.getByLabelText('cs'))
    expect(screen.getByText('New (1)')).toBeInTheDocument()
    expect(screen.queryByText('Category 2 (1)')).not.toBeInTheDocument()
  })

  it('labels a streak-0 card with prior lapses as Struggling, separate from New', async () => {
    vi.mocked(api.notes.listAllCards).mockResolvedValue([
      ...cards,
      { ...cards[0]!, front: 'Q3', position: 1, lapses: 4 },
    ])
    render(<DeckView onClose={vi.fn()} onOpenCram={vi.fn()} />)
    await waitFor(() => screen.getByText('Q1'))
    expect(screen.getByText('New (1)')).toBeInTheDocument()
    expect(screen.getByText('Struggling (1)')).toBeInTheDocument()
  })

  it('calls onOpenCram with struggling=true when the Struggling chip is clicked', async () => {
    vi.mocked(api.notes.listAllCards).mockResolvedValue([
      ...cards,
      { ...cards[0]!, front: 'Q3', position: 1, lapses: 4 },
    ])
    const onOpenCram = vi.fn()
    render(<DeckView onClose={vi.fn()} onOpenCram={onOpenCram} />)
    await waitFor(() => screen.getByText('Struggling (1)'))
    const chip = screen.getByText('Struggling (1)').closest('.deck-view-category')
    if (!chip) throw new Error('chip not found')
    fireEvent.click(chip.querySelector('.deck-view-category-cram') as HTMLElement)
    expect(onOpenCram).toHaveBeenCalledWith(0, true)
  })
})

describe('DeckView — suspended cards', () => {
  it('displays suspended count filter when suspended cards exist', async () => {
    vi.mocked(api.notes.listAllCards).mockResolvedValue([
      cards[0]!,
      { ...cards[1]!, suspended: true },
    ])
    render(<DeckView onClose={vi.fn()} onOpenCram={vi.fn()} />)
    await waitFor(() => screen.getByText('Q1'))
    expect(screen.getByText('1 suspended')).toBeInTheDocument()
  })

  it('filters to suspended cards when suspended filter chip is clicked', async () => {
    vi.mocked(api.notes.listAllCards).mockResolvedValue([
      cards[0]!,
      { ...cards[1]!, suspended: true },
    ])
    render(<DeckView onClose={vi.fn()} onOpenCram={vi.fn()} />)
    await waitFor(() => screen.getByText('Q1'))
    fireEvent.click(screen.getByText('1 suspended'))
    expect(screen.queryByText('Q1')).not.toBeInTheDocument()
    expect(screen.getByText('Q2')).toBeInTheDocument()
    expect(screen.getByText('Suspended')).toBeInTheDocument()
  })

  it('toggles card suspension on button click', async () => {
    vi.mocked(api.notes.setCardSuspended).mockResolvedValue(undefined)
    vi.mocked(api.notes.listAllCards).mockResolvedValue(cards)
    render(<DeckView onClose={vi.fn()} onOpenCram={vi.fn()} />)
    await waitFor(() => screen.getByText('Q1'))

    fireEvent.click(screen.getByLabelText('Suspend card Q1'))
    await waitFor(() =>
      expect(api.notes.setCardSuspended).toHaveBeenCalledWith('/ws/a.md', 0, true, '/ws'),
    )
    expect(useWorkspaceStore.getState().gitPendingPaths).toContain('/ws/a.md')
  })
})
