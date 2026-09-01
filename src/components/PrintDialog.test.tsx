import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PrintDialog } from './PrintDialog'
import { api } from '../lib/tauri'
import { showToast } from '../store/toast'
import { usePrintPreview } from '../hooks/usePrintPreview'

vi.mock('../lib/tauri', () => ({
  api: { printing: { listPrinters: vi.fn(), printDocument: vi.fn() } },
}))
vi.mock('../store/toast', () => ({ showToast: vi.fn() }))
vi.mock('../hooks/usePrintPreview', () => ({
  usePrintPreview: vi.fn(),
}))

const listPrinters = vi.mocked(api.printing.listPrinters)
const printDocument = vi.mocked(api.printing.printDocument)
const previewHook = vi.mocked(usePrintPreview)

function makePreviewResult(overrides: Partial<ReturnType<typeof usePrintPreview>> = {}) {
  return {
    containerRef: { current: null },
    showPageNumber: false,
    setShowPageNumber: vi.fn(),
    showTitle: false,
    setShowTitle: vi.fn(),
    showDate: false,
    setShowDate: vi.fn(),
    isRendering: false,
    error: null,
    ...overrides,
  }
}

beforeEach(() => {
  listPrinters.mockResolvedValue([
    { name: 'HP LaserJet', isDefault: false },
    { name: 'Microsoft Print to PDF', isDefault: true },
  ])
  printDocument.mockResolvedValue(undefined)
  previewHook.mockReturnValue(makePreviewResult())
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('PrintDialog', () => {
  it('preselects the default printer', async () => {
    render(<PrintDialog noteTitle="Lecture 7" contentRef={{ current: null }} onClose={vi.fn()} />)
    expect(await screen.findByRole('combobox')).toHaveValue('Microsoft Print to PDF')
  })

  it('prints the preselected printer', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<PrintDialog noteTitle="Lecture 7" contentRef={{ current: null }} onClose={onClose} />)

    await screen.findByRole('combobox')
    await user.click(screen.getByRole('button', { name: 'Print' }))

    expect(printDocument).toHaveBeenCalledWith('Microsoft Print to PDF')
    expect(onClose).toHaveBeenCalled()
  })

  it('renders three independent checkboxes', async () => {
    render(<PrintDialog noteTitle="Lecture 7" contentRef={{ current: null }} onClose={vi.fn()} />)
    await screen.findByRole('combobox')
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
  })

  it('toasts the error message on print failure', async () => {
    printDocument.mockRejectedValue(new Error('printer offline'))
    const user = userEvent.setup()
    render(<PrintDialog noteTitle="Lecture 7" contentRef={{ current: null }} onClose={vi.fn()} />)

    await screen.findByRole('combobox')
    await user.click(screen.getByRole('button', { name: 'Print' }))

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('printer offline'))
  })

  it('disables Print while the preview is rendering, even with a printer selected', async () => {
    previewHook.mockReturnValue(makePreviewResult({ isRendering: true }))
    render(<PrintDialog noteTitle="Lecture 7" contentRef={{ current: null }} onClose={vi.fn()} />)

    expect(await screen.findByRole('button', { name: 'Print' })).toBeDisabled()
  })

  it('disables Print when no printers are found', async () => {
    listPrinters.mockResolvedValue([])
    render(<PrintDialog noteTitle="Lecture 7" contentRef={{ current: null }} onClose={vi.fn()} />)

    expect(await screen.findByRole('button', { name: 'Print' })).toBeDisabled()
  })
})
