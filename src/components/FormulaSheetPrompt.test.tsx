import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { platform } from '@tauri-apps/plugin-os'
import { FormulaSheetPrompt } from './FormulaSheetPrompt'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'

vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn(() => 'android') }))
vi.mock('../lib/tauri', () => ({
  api: { notes: { generateFormulaSheet: vi.fn(), generateSolutionsSheet: vi.fn() } },
}))

const META = { id: 'f', title: 'Formula Sheet', path: '/ws/Formula Sheet.md', workspace: '/ws', updatedAt: 0 }

beforeEach(() => {
  vi.mocked(api.notes.generateFormulaSheet).mockResolvedValue(META)
  useWorkspaceStore.setState({ path: '/ws', openTabs: [], activeTab: null })
  useNotesStore.setState({
    notes: [{ id: 'a', title: 'A', path: '/ws/Discrete Mathematics/a.md', workspace: '/ws', updatedAt: 0 }],
    folders: ['/ws/Discrete Mathematics'],
    tags: ['exam'],
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('FormulaSheetPrompt on a phone', () => {
  it('offers a scope list instead of the query input, with no Cancel', () => {
    render(<FormulaSheetPrompt onClose={vi.fn()} />)
    expect(screen.queryByPlaceholderText('folder:Course101')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(screen.getByRole('radio', { name: /Whole workspace/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('generates from the whole workspace by default', async () => {
    render(<FormulaSheetPrompt onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Generate formula sheet' }))
    expect(api.notes.generateFormulaSheet).toHaveBeenCalledWith('/ws', null, null)
  })

  it('scopes to a picked folder, spaces and all, with a trailing separator', async () => {
    render(<FormulaSheetPrompt onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('radio', { name: /Discrete Mathematics/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Generate formula sheet' }))
    expect(api.notes.generateFormulaSheet).toHaveBeenCalledWith('/ws', '/ws/Discrete Mathematics/', null)
  })

  it('picking a tag replaces the folder scope', async () => {
    render(<FormulaSheetPrompt onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('radio', { name: /Discrete Mathematics/ }))
    await userEvent.click(screen.getByRole('radio', { name: '#exam' }))
    await userEvent.click(screen.getByRole('button', { name: 'Generate formula sheet' }))
    expect(api.notes.generateFormulaSheet).toHaveBeenCalledWith('/ws', null, 'exam')
  })
})

describe('FormulaSheetPrompt on desktop', () => {
  it('keeps the typed folder:/tag: query', async () => {
    vi.mocked(platform).mockReturnValue('windows')
    render(<FormulaSheetPrompt onClose={vi.fn()} />)
    await userEvent.type(screen.getByPlaceholderText('folder:Course101'), 'folder:Algo tag:exam')
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(api.notes.generateFormulaSheet).toHaveBeenCalledWith('/ws', 'Algo', 'exam')
    vi.mocked(platform).mockReturnValue('android')
  })
})
