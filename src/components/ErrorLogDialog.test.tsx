import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ErrorLogDialog } from './ErrorLogDialog'
import { api } from '../lib/tauri'
import { writeToClipboard } from '../lib/clipboard'

vi.mock('../lib/tauri', () => ({
  api: { errorLog: { list: vi.fn(), clear: vi.fn() } },
}))

vi.mock('../lib/clipboard', () => ({ writeToClipboard: vi.fn().mockResolvedValue(undefined) }))

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

  it('filters entries by source or message', async () => {
    const user = userEvent.setup()
    list.mockResolvedValueOnce([
      { timestamp: '2026-09-05T00:00:00Z', source: 'panic', message: 'boom', context: null },
      { timestamp: '2026-09-05T00:00:01Z', source: 'network', message: 'timeout', context: null },
    ])
    render(<ErrorLogDialog onClose={vi.fn()} />)
    await screen.findByText('boom')

    await user.type(screen.getByLabelText(/filter error log entries/i), 'timeout')

    expect(screen.queryByText('boom')).toBeNull()
    expect(screen.getByText('timeout')).toBeInTheDocument()
  })

  it('shows a no-match empty state distinct from the no-errors empty state', async () => {
    const user = userEvent.setup()
    list.mockResolvedValueOnce([
      { timestamp: '2026-09-05T00:00:00Z', source: 'panic', message: 'boom', context: null },
    ])
    render(<ErrorLogDialog onClose={vi.fn()} />)
    await screen.findByText('boom')

    await user.type(screen.getByLabelText(/filter error log entries/i), 'nothing matches this')

    expect(await screen.findByText(/no errors match/i)).toBeInTheDocument()
  })

  it('expands a stack trace on demand and copies the full entry', async () => {
    const user = userEvent.setup()
    list.mockResolvedValueOnce([
      { timestamp: '2026-09-05T00:00:00Z', source: 'react-boundary', message: 'boom', context: 'at Foo\nat Bar' },
    ])
    render(<ErrorLogDialog onClose={vi.fn()} />)
    await screen.findByText('boom')

    expect(screen.queryByText(/at Foo/)).toBeNull()
    await user.click(screen.getByRole('button', { name: /show stack trace/i }))
    expect(screen.getByText(/at Foo/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^copy$/i }))
    expect(writeToClipboard).toHaveBeenCalledWith(
      '[2026-09-05T00:00:00Z] react-boundary: boom\nat Foo\nat Bar',
    )
    expect(await screen.findByRole('button', { name: /^copied$/i })).toBeInTheDocument()
  })
})
