import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { WorkspacePicker } from './WorkspacePicker'
import { useWorkspaceStore } from '../store/workspace'

afterEach(() => {
  cleanup()
})

describe('WorkspacePicker loading state', () => {
  it('disables the browse button and shows "Opening…" while a workspace is loading', () => {
    useWorkspaceStore.setState({ recentWorkspaces: [], folderLoading: true })
    render(<WorkspacePicker />)

    const button = screen.getByRole('button', { name: /Opening…/ })
    expect(button).toBeDisabled()
  })

  it('shows the normal label and an enabled button when not loading', () => {
    useWorkspaceStore.setState({ recentWorkspaces: [], folderLoading: false })
    render(<WorkspacePicker />)

    const button = screen.getByRole('button', { name: /Choose a folder…/ })
    expect(button).toBeEnabled()
  })
})
