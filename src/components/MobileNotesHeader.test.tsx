import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MobileNotesHeader } from './MobileNotesHeader'
import { ActionSheet } from './ActionSheet'
import { useActionSheetStore } from '../store/actionSheet'
import { useWorkspaceStore } from '../store/workspace'

const closeWorkspace = vi.fn()
const openWorkspaceAt = vi.fn()

vi.mock('../hooks/useWorkspace', () => ({ useWorkspace: () => ({ closeWorkspace, openWorkspaceAt }) }))
vi.mock('../hooks/useCreateFolder', () => ({ useCreateFolder: () => vi.fn() }))
vi.mock('../hooks/useCreateCanvasNote', () => ({ useCreateCanvasNote: () => vi.fn() }))

beforeEach(() => {
  useActionSheetStore.setState({ sheet: null })
  useWorkspaceStore.setState({ path: '/ws/current', recentWorkspaces: ['/ws/current', '/ws/other'] })
  render(<><MobileNotesHeader onTemplateOpen={vi.fn()} /><ActionSheet /></>)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('MobileNotesHeader workspace sheet', () => {
  it('lists other recents and opens the one tapped', async () => {
    await userEvent.click(screen.getByRole('button', { name: /current/ }))
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'current' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'other' }))
    expect(openWorkspaceAt).toHaveBeenCalledWith('/ws/other')
  })

  it('offers a way back to the workspace picker even with no other recents', async () => {
    useWorkspaceStore.setState({ recentWorkspaces: ['/ws/current'] })
    await userEvent.click(screen.getByRole('button', { name: /current/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Open or clone another…' }))
    expect(closeWorkspace).toHaveBeenCalledTimes(1)
  })
})
