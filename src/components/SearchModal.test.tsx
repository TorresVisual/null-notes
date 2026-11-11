import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { platform } from '@tauri-apps/plugin-os'
import { SearchModal } from './SearchModal'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'

vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn(() => 'windows') }))
vi.mock('../lib/tauri', () => ({
  api: { notes: { search: vi.fn() }, pdf: { findPage: vi.fn() } },
}))
vi.mock('../hooks/useWorkspace', () => ({
  useWorkspace: () => ({ openWorkspaceAt: vi.fn() }),
}))

Element.prototype.scrollIntoView = vi.fn()

beforeEach(() => {
  useWorkspaceStore.setState({ path: '/ws', recentSearches: ['tag:exam', 'mutex'] })
  vi.mocked(api.notes.search).mockResolvedValue({ results: [], total: 0 })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SearchModal on desktop', () => {
  it('keeps the checkbox scope toggle and no mobile controls', () => {
    render(<SearchModal onClose={vi.fn()} />)
    expect(screen.getByRole('checkbox')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'folder:' })).not.toBeInTheDocument()
  })
})

describe('SearchModal on mobile', () => {
  beforeEach(() => {
    vi.mocked(platform).mockReturnValue('android')
  })

  it('closes from the back arrow', async () => {
    const onClose = vi.fn()
    render(<SearchModal onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('inserts an operator chip into the query', async () => {
    render(<SearchModal onClose={vi.fn()} />)
    const input = screen.getByPlaceholderText('Search notes')
    await userEvent.type(input, 'mutex')
    await userEvent.click(screen.getByRole('button', { name: 'folder:' }))
    expect(input).toHaveValue('mutex folder:')
  })

  it('switches scope with the segmented toggle', async () => {
    render(<SearchModal onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'This workspace' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'All workspaces' }))
    expect(screen.getByRole('button', { name: 'All workspaces' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('clears recent searches from the empty state', async () => {
    render(<SearchModal onClose={vi.fn()} />)
    expect(screen.getByText('tag:exam')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(useWorkspaceStore.getState().recentSearches).toEqual([])
  })
})
