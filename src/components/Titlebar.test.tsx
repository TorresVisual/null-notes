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
    render(<Titlebar title="Lecture 7 — Notes — null-notes" onCommand={vi.fn()} />)
    expect(screen.getByText('Lecture 7 — Notes — null-notes')).toBeInTheDocument()
  })

  it('dispatches the command id when a File menu item is picked', async () => {
    const user = userEvent.setup()
    const onCommand = vi.fn()
    render(<Titlebar title="null-notes" onCommand={onCommand} />)
    await user.click(screen.getByText('File'))
    await user.click(await screen.findByText('Open Workspace…'))
    expect(onCommand).toHaveBeenCalledWith('open-workspace')
  })

  it('wires the window controls to the Tauri window API', () => {
    render(<Titlebar title="null-notes" onCommand={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Minimize'))
    expect(minimize).toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('Maximize'))
    expect(toggleMaximize).toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('Close'))
    expect(close).toHaveBeenCalled()
  })
})
