import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Titlebar } from './Titlebar'

const setTitle = vi.fn()
const isMaximized = vi.fn().mockResolvedValue(false)
const onResized = vi.fn().mockResolvedValue(vi.fn())
const minimize = vi.fn()
const toggleMaximize = vi.fn()
const close = vi.fn()

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ setTitle, isMaximized, onResized, minimize, toggleMaximize, close }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Titlebar', () => {
  it('shows the given title', () => {
    render(<Titlebar title="Lecture 7 — Notes — Null Notes" onCommand={vi.fn()} />)
    expect(screen.getByText('Lecture 7 — Notes — Null Notes')).toBeInTheDocument()
  })

  it('dispatches the command id when a File menu item is picked', async () => {
    const user = userEvent.setup()
    const onCommand = vi.fn()
    render(<Titlebar title="Null Notes" onCommand={onCommand} />)
    await user.click(screen.getByText('File'))
    await user.click(await screen.findByText('Open Workspace…'))
    expect(onCommand).toHaveBeenCalledWith('open-workspace')
  })

  it('dispatches close-workspace when picked from the File menu', async () => {
    const user = userEvent.setup()
    const onCommand = vi.fn()
    render(<Titlebar title="Null Notes" onCommand={onCommand} />)
    await user.click(screen.getByText('File'))
    await user.click(await screen.findByText('Close Workspace'))
    expect(onCommand).toHaveBeenCalledWith('close-workspace')
  })

  it('lists recent workspaces under Open Workspace, most-recent first', async () => {
    const user = userEvent.setup()
    render(
      <Titlebar
        title="Null Notes"
        onCommand={vi.fn()}
        recentWorkspaces={['/ws/Lecture Notes', '/ws/CS 101']}
      />,
    )
    await user.click(screen.getByText('File'))
    expect(await screen.findByText('Lecture Notes')).toBeInTheDocument()
    expect(screen.getByText('CS 101')).toBeInTheDocument()
  })

  it('dispatches open-recent:<path> when a recent workspace is picked', async () => {
    const user = userEvent.setup()
    const onCommand = vi.fn()
    render(
      <Titlebar title="Null Notes" onCommand={onCommand} recentWorkspaces={['/ws/Lecture Notes']} />,
    )
    await user.click(screen.getByText('File'))
    await user.click(await screen.findByText('Lecture Notes'))
    expect(onCommand).toHaveBeenCalledWith('open-recent:/ws/Lecture Notes')
  })

  it('wires the window controls to the Tauri window API', () => {
    render(<Titlebar title="Null Notes" onCommand={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Minimize'))
    expect(minimize).toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('Maximize'))
    expect(toggleMaximize).toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('Close'))
    expect(close).toHaveBeenCalled()
  })

  it('keeps Toggle Terminal in the View menu on desktop', async () => {
    const user = userEvent.setup()
    render(<Titlebar title="Null Notes" onCommand={vi.fn()} />)
    await user.click(screen.getByText('View'))
    expect(await screen.findByText('Toggle Terminal')).toBeInTheDocument()
  })
})
