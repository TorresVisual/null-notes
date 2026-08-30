import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportPdfDialog } from './ExportPdfDialog'
import { api } from '../lib/tauri'
import { save } from '@tauri-apps/plugin-dialog'
import { showToast } from '../store/toast'

vi.mock('../lib/tauri', () => ({
  api: { printing: { exportPdf: vi.fn() } },
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(),
}))
vi.mock('../store/toast', () => ({ showToast: vi.fn() }))

const exportPdf = vi.mocked(api.printing.exportPdf)
const saveDialog = vi.mocked(save)

beforeEach(() => {
  saveDialog.mockResolvedValue('C:\\notes\\Lecture 7.pdf')
  exportPdf.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ExportPdfDialog', () => {
  it('exports with the checkbox off by default', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ExportPdfDialog noteTitle="Lecture 7" onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: /Choose Location & Export/ }))

    expect(saveDialog).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'Lecture 7.pdf' }))
    expect(exportPdf).toHaveBeenCalledWith('C:\\notes\\Lecture 7.pdf', false)
    expect(onClose).toHaveBeenCalled()
  })

  it('passes the checkbox state through when checked', async () => {
    const user = userEvent.setup()
    render(<ExportPdfDialog noteTitle="Lecture 7" onClose={vi.fn()} />)

    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /Choose Location & Export/ }))

    expect(exportPdf).toHaveBeenCalledWith('C:\\notes\\Lecture 7.pdf', true)
  })

  it('does nothing when the save dialog is cancelled', async () => {
    saveDialog.mockResolvedValue(null)
    const user = userEvent.setup()
    render(<ExportPdfDialog noteTitle="Lecture 7" onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /Choose Location & Export/ }))

    expect(exportPdf).not.toHaveBeenCalled()
  })

  it('toasts the error message on failure and re-enables the button', async () => {
    exportPdf.mockRejectedValue(new Error('printer offline'))
    const user = userEvent.setup()
    render(<ExportPdfDialog noteTitle="Lecture 7" onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /Choose Location & Export/ }))

    expect(await screen.findByRole('button', { name: /Choose Location & Export/ })).not.toBeDisabled()
    expect(showToast).toHaveBeenCalledWith('printer offline')
  })
})
