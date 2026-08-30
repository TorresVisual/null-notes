import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PrintDialog } from './PrintDialog'
import { api } from '../lib/tauri'
import { showToast } from '../store/toast'

vi.mock('../lib/tauri', () => ({
  api: { printing: { listPrinters: vi.fn(), printDocument: vi.fn() } },
}))
vi.mock('../store/toast', () => ({ showToast: vi.fn() }))

const listPrinters = vi.mocked(api.printing.listPrinters)
const printDocument = vi.mocked(api.printing.printDocument)

beforeEach(() => {
  listPrinters.mockResolvedValue([
    { name: 'HP LaserJet', isDefault: false },
    { name: 'Microsoft Print to PDF', isDefault: true },
  ])
  printDocument.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('PrintDialog', () => {
  it('preselects the default printer', async () => {
    render(<PrintDialog onClose={vi.fn()} />)
    expect(await screen.findByRole('combobox')).toHaveValue('Microsoft Print to PDF')
  })

  it('prints the preselected printer with the checkbox off by default', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<PrintDialog onClose={onClose} />)

    await screen.findByRole('combobox')
    await user.click(screen.getByRole('button', { name: 'Print' }))

    expect(printDocument).toHaveBeenCalledWith('Microsoft Print to PDF', false)
    expect(onClose).toHaveBeenCalled()
  })

  it('prints whichever printer is chosen from the select', async () => {
    const user = userEvent.setup()
    render(<PrintDialog onClose={vi.fn()} />)

    await user.selectOptions(await screen.findByRole('combobox'), 'HP LaserJet')
    await user.click(screen.getByRole('button', { name: 'Print' }))

    expect(printDocument).toHaveBeenCalledWith('HP LaserJet', false)
  })

  it('toasts the error message on failure', async () => {
    printDocument.mockRejectedValue(new Error('printer offline'))
    const user = userEvent.setup()
    render(<PrintDialog onClose={vi.fn()} />)

    await screen.findByRole('combobox')
    await user.click(screen.getByRole('button', { name: 'Print' }))

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('printer offline'))
  })

  it('disables Print when no printers are found', async () => {
    listPrinters.mockResolvedValue([])
    render(<PrintDialog onClose={vi.fn()} />)

    expect(await screen.findByRole('button', { name: 'Print' })).toBeDisabled()
  })
})
