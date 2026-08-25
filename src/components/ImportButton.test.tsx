import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImportButton } from './ImportButton'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { api } from '../lib/tauri'
import { showToast } from '../store/toast'

vi.mock('../lib/tauri', () => ({
  api: {
    pdf: {
      hasTextLayer: vi.fn(),
      importMarkdown: vi.fn(),
      importPages: vi.fn(),
    },
    notes: {
      create: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
      reindex: vi.fn().mockResolvedValue(undefined),
    },
    assets: { write: vi.fn() },
    settings: { save: vi.fn().mockResolvedValue(undefined) },
  },
}))
vi.mock('../pdf/usePdfImport', () => ({
  usePdfImport: () => ({
    pickPdf: vi.fn().mockResolvedValue({ path: '/tmp/Lecture 7.pdf', title: 'Lecture 7' }),
    importPages: vi.fn(),
    isImporting: false,
    progress: null,
  }),
}))
vi.mock('../store/toast', () => ({ showToast: vi.fn() }))

beforeEach(() => {
  useWorkspaceStore.setState({ path: '/ws', selectedFolder: null })
  useNotesStore.setState({ notes: [], folders: [], tags: [] })
  vi.mocked(api.pdf.hasTextLayer).mockResolvedValue(true)
  vi.mocked(api.pdf.importMarkdown).mockResolvedValue({ markdown: 'Body text', images: [] })
  vi.mocked(api.notes.create).mockResolvedValue({
    id: '1',
    path: '/ws/Lecture 7.md',
    title: 'Lecture 7',
    workspace: '/ws',
    updatedAt: 0,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ImportButton', () => {
  it('shows a toast naming the note once a Markdown import succeeds', async () => {
    const user = userEvent.setup()
    render(<ImportButton />)

    await user.click(screen.getByRole('button', { name: /Import PDF/ }))
    await user.click(await screen.findByRole('button', { name: /As Markdown/ }))

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Imported "Lecture 7"'))
  })
})
