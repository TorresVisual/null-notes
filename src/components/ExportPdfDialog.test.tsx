import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportPdfDialog } from './ExportPdfDialog'
import { api } from '../lib/tauri'
import { save } from '@tauri-apps/plugin-dialog'
import { showToast } from '../store/toast'
import { usePrintPreview } from '../hooks/usePrintPreview'

vi.mock('../lib/tauri', () => ({
  api: { printing: { exportPdf: vi.fn() } },
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(),
}))
vi.mock('../store/toast', () => ({ showToast: vi.fn() }))
vi.mock('../hooks/usePrintPreview', () => ({
  usePrintPreview: vi.fn(),
}))

const exportPdf = vi.mocked(api.printing.exportPdf)
const saveDialog = vi.mocked(save)
const previewHook = vi.mocked(usePrintPreview)

function makePreviewResult(overrides: Partial<ReturnType<typeof usePrintPreview>> = {}) {
  return {
    containerRef: () => {},
    showPageNumber: false,
    setShowPageNumber: vi.fn(),
    showTitle: false,
    setShowTitle: vi.fn(),
    showDate: false,
    setShowDate: vi.fn(),
    isRendering: false,
    error: null,
    printPages: <T,>(run: () => Promise<T>) => run(),
    ...overrides,
  }
}

beforeEach(() => {
  saveDialog.mockResolvedValue('C:\\notes\\Lecture 7.pdf')
  exportPdf.mockResolvedValue(undefined)
  previewHook.mockReturnValue(makePreviewResult())
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ExportPdfDialog', () => {
  it('exports to the chosen path', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ExportPdfDialog noteTitle="Lecture 7" contentRef={{ current: null }} onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: /Choose Location & Export/ }))

    expect(saveDialog).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'Lecture 7.pdf' }))
    expect(exportPdf).toHaveBeenCalledWith('C:\\notes\\Lecture 7.pdf')
    expect(onClose).toHaveBeenCalled()
  })

  it('renders three independent checkboxes wired to the preview hook', async () => {
    const setShowPageNumber = vi.fn()
    previewHook.mockReturnValue(makePreviewResult({ setShowPageNumber }))
    const user = userEvent.setup()
    render(<ExportPdfDialog noteTitle="Lecture 7" contentRef={{ current: null }} onClose={vi.fn()} />)

    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(3)
    await user.click(screen.getByLabelText('Page numbers'))

    expect(setShowPageNumber).toHaveBeenCalledWith(true)
  })

  it('does nothing when the save dialog is cancelled', async () => {
    saveDialog.mockResolvedValue(null)
    const user = userEvent.setup()
    render(<ExportPdfDialog noteTitle="Lecture 7" contentRef={{ current: null }} onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /Choose Location & Export/ }))

    expect(exportPdf).not.toHaveBeenCalled()
  })

  it('disables Export while the preview is rendering', () => {
    previewHook.mockReturnValue(makePreviewResult({ isRendering: true }))
    render(<ExportPdfDialog noteTitle="Lecture 7" contentRef={{ current: null }} onClose={vi.fn()} />)

    expect(screen.getByRole('button', { name: /Choose Location & Export/ })).toBeDisabled()
  })

  it('toasts a preview error', () => {
    previewHook.mockReturnValue(makePreviewResult({ error: 'paged.js exploded' }))
    render(<ExportPdfDialog noteTitle="Lecture 7" contentRef={{ current: null }} onClose={vi.fn()} />)

    expect(showToast).toHaveBeenCalledWith('paged.js exploded')
  })

  it('toasts the error message on export failure and re-enables the button', async () => {
    exportPdf.mockRejectedValue(new Error('printer offline'))
    const user = userEvent.setup()
    render(<ExportPdfDialog noteTitle="Lecture 7" contentRef={{ current: null }} onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /Choose Location & Export/ }))

    expect(await screen.findByRole('button', { name: /Choose Location & Export/ })).not.toBeDisabled()
    expect(showToast).toHaveBeenCalledWith("Couldn't export the PDF: printer offline")
  })
})
