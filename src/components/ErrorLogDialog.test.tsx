import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ErrorLogDialog } from './ErrorLogDialog'
import { api } from '../lib/tauri'

vi.mock('../lib/tauri', () => ({
  api: { errorLog: { list: vi.fn(), clear: vi.fn() } },
}))

const list = vi.mocked(api.errorLog.list)
const clear = vi.mocked(api.errorLog.clear)

afterEach(() => cleanup())

describe('ErrorLogDialog', () => {
  it('shows an empty state when there are no entries', async () => {
    list.mockResolvedValueOnce([])
    render(<ErrorLogDialog onClose={vi.fn()} />)

    expect(await screen.findByText(/no errors recorded/i)).toBeInTheDocument()
  })

  it('lists fetched entries', async () => {
    list.mockResolvedValueOnce([
      { timestamp: '2026-09-05T00:00:00Z', source: 'panic', message: 'boom', context: null },
    ])
    render(<ErrorLogDialog onClose={vi.fn()} />)

    expect(await screen.findByText('boom')).toBeInTheDocument()
    expect(screen.getByText('panic')).toBeInTheDocument()
  })

  it('clears the log and empties the list on Clear', async () => {
    const user = userEvent.setup()
    list.mockResolvedValueOnce([
      { timestamp: '2026-09-05T00:00:00Z', source: 'panic', message: 'boom', context: null },
    ])
    clear.mockResolvedValueOnce(undefined)
    render(<ErrorLogDialog onClose={vi.fn()} />)
    await screen.findByText('boom')

    await user.click(screen.getByRole('button', { name: /clear log/i }))

    await waitFor(() => expect(screen.queryByText('boom')).toBeNull())
    expect(clear).toHaveBeenCalled()
  })
})
