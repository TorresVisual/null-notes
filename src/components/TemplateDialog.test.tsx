import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TemplateDialog } from './TemplateDialog'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'
import { showToast } from '../store/toast'

vi.mock('../lib/tauri', () => ({
  api: {
    templates: {
      list: vi.fn(),
      read: vi.fn(),
      createNote: vi.fn(),
    },
  },
}))
vi.mock('../store/toast', () => ({ showToast: vi.fn() }))

beforeEach(() => {
  useWorkspaceStore.setState({ path: '/ws', selectedFolder: null })
  vi.mocked(api.templates.list).mockResolvedValue([{ path: '/ws/templates/exercise.md', name: 'Exercise sheet' }])
  vi.mocked(api.templates.read).mockResolvedValue('# {{title}}\n')
  vi.mocked(api.templates.createNote).mockResolvedValue({
    id: '1',
    path: '/ws/Sheet 3.md',
    title: 'Sheet 3',
    workspace: '/ws',
    updatedAt: 0,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TemplateDialog', () => {
  it('shows a toast naming the note once creation succeeds', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<TemplateDialog onClose={onClose} />)

    await user.click(await screen.findByText('Exercise sheet'))
    await user.type(screen.getByLabelText(/Note title/), 'Sheet 3')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Created "Sheet 3"'))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
