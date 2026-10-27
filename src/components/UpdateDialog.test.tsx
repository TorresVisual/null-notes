import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { check } from '@tauri-apps/plugin-updater'
import { UpdateDialog } from './UpdateDialog'
import { api } from '../lib/tauri'

vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn() }))
vi.mock('../lib/tauri', () => ({ api: { window: { isReleaseBuild: vi.fn() } } }))

const isReleaseBuild = vi.mocked(api.window.isReleaseBuild)
const checkMock = vi.mocked(check)
const downloadAndInstall = vi.fn()
const update = { version: '1.1.0', body: '- fix a thing', downloadAndInstall } as unknown as Awaited<ReturnType<typeof check>>

beforeEach(() => {
  isReleaseBuild.mockResolvedValue(true)
  checkMock.mockResolvedValue(update)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('UpdateDialog', () => {
  it('shows the new version and notes when an update exists', async () => {
    render(<UpdateDialog />)
    expect(await screen.findByText(/v1\.1\.0/)).toBeInTheDocument()
    expect(screen.getByText('- fix a thing')).toBeInTheDocument()
  })

  it('does not check in debug builds', async () => {
    isReleaseBuild.mockResolvedValue(false)
    render(<UpdateDialog />)
    await Promise.resolve()
    expect(checkMock).not.toHaveBeenCalled()
  })

  it('stays silent when the check fails', async () => {
    checkMock.mockRejectedValue(new Error('offline'))
    render(<UpdateDialog />)
    await Promise.resolve()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('installs on confirm and closes on Later', async () => {
    render(<UpdateDialog />)
    await userEvent.click(await screen.findByRole('button', { name: /install and restart/i }))
    expect(downloadAndInstall).toHaveBeenCalled()
    cleanup()
    render(<UpdateDialog />)
    await userEvent.click(await screen.findByRole('button', { name: 'Later' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
