import { describe, it, expect, vi } from 'vitest'
import { api } from './tauri'

vi.mock('./tauri', () => ({
  api: { errorLog: { record: vi.fn() } },
}))

const record = vi.mocked(api.errorLog.record)

describe('logError', () => {
  it('forwards source, message, and context to api.errorLog.record', async () => {
    const { logError } = await import('./errorLog')
    record.mockResolvedValueOnce(undefined)

    logError('console-error', 'boom', 'at foo.ts:1')

    expect(record).toHaveBeenCalledWith('console-error', 'boom', 'at foo.ts:1')
  })

  it('defaults context to null when omitted', async () => {
    const { logError } = await import('./errorLog')
    record.mockResolvedValueOnce(undefined)

    logError('window-error', 'boom')

    expect(record).toHaveBeenCalledWith('window-error', 'boom', null)
  })

  it('never throws when the underlying invoke rejects', async () => {
    const { logError } = await import('./errorLog')
    record.mockRejectedValueOnce(new Error('ipc down'))

    expect(() => logError('console-error', 'boom')).not.toThrow()
  })
})
