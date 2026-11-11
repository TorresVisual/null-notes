import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { WorkspacePicker } from './WorkspacePicker'
import { useWorkspaceStore } from '../store/workspace'
import { useWorkspace } from '../hooks/useWorkspace'
import { platform } from '@tauri-apps/plugin-os'

vi.mock('../hooks/useWorkspace')
vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn() }))

let mockWorkspace: ReturnType<typeof useWorkspace>

beforeEach(() => {
  useWorkspaceStore.setState({ recentWorkspaces: [], folderLoading: false, folderError: null })
  vi.mocked(platform).mockReturnValue('windows')
  mockWorkspace = {
    openWorkspace: vi.fn(),
    openWorkspaceAt: vi.fn().mockResolvedValue(undefined),
    openSingleNote: vi.fn().mockResolvedValue(undefined),
    saveSession: vi.fn(),
    closeWorkspace: vi.fn(),
  }
  vi.mocked(useWorkspace).mockReturnValue(mockWorkspace)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('WorkspacePicker loading state', () => {
  it('disables the browse button and shows "Opening…" while a workspace is loading', () => {
    useWorkspaceStore.setState({ folderLoading: true })
    render(<WorkspacePicker />)

    const button = screen.getByRole('button', { name: /Opening…/ })
    expect(button).toBeDisabled()
  })

  it('shows the normal label and an enabled button when not loading', () => {
    render(<WorkspacePicker />)

    const button = screen.getByRole('button', { name: /Choose a folder…/ })
    expect(button).toBeEnabled()
  })
})

describe('WorkspacePicker open failure', () => {
  it('announces why a folder could not be opened', () => {
    useWorkspaceStore.setState({ folderError: 'No such file or directory (os error 2)' })
    render(<WorkspacePicker />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't open that folder — No such file or directory (os error 2)",
    )
  })

  it('shows no alert when nothing failed', () => {
    render(<WorkspacePicker />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('WorkspacePicker on desktop', () => {
  it('keeps the existing folder/clone buttons', () => {
    render(<WorkspacePicker />)

    expect(screen.getByText('Choose a folder…')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('https://github.com/me/notes.git')).not.toBeInTheDocument()
  })
})
