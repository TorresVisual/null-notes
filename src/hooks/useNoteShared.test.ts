import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useNote, SAVE_DEBOUNCE_MS } from './useNote'
import { useWorkspaceStore } from '../store/workspace'
import { useDirtyPathsStore } from '../store/dirtyPaths'
import { api } from '../lib/tauri'

vi.mock('../lib/tauri', () => ({
  api: {
    notes: { open: vi.fn(), save: vi.fn(), reindex: vi.fn() },
    assets: { gc: vi.fn().mockResolvedValue(undefined) },
  },
}))

type ChangeHandler = (event: { payload: string[] }) => void | Promise<void>
let emitWorkspaceChanged: ChangeHandler = () => {}

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((_event: string, handler: ChangeHandler) => {
    emitWorkspaceChanged = handler
    return Promise.resolve(() => {})
  }),
}))

const notes = vi.mocked(api.notes)
let n = 0
let PATH = ''

describe('useNote with two holders of one note', () => {
  beforeEach(() => {
    PATH = `/ws/shared-${++n}.md`
    vi.useFakeTimers({ shouldAdvanceTime: true })
    useWorkspaceStore.setState({ path: '/ws' })
    useDirtyPathsStore.setState({ paths: new Set() })
    notes.open.mockResolvedValue('# A\n')
    notes.save.mockResolvedValue(undefined)
    notes.reindex.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('shares one buffer: an edit in one shows in the other, with no conflict after the echo', async () => {
    const first = renderHook(() => useNote(PATH))
    const second = renderHook(() => useNote(PATH))
    await waitFor(() => expect(first.result.current.isLoading).toBe(false))
    await waitFor(() => expect(second.result.current.isLoading).toBe(false))
    expect(notes.open).toHaveBeenCalledTimes(1)

    act(() => first.result.current.save('# A\nx'))
    expect(second.result.current.content).toBe('# A\nx')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 100)
    })
    notes.open.mockResolvedValue('# A\nx')
    await act(async () => {
      await emitWorkspaceChanged({ payload: [PATH] })
    })

    expect(notes.save).toHaveBeenCalledTimes(1)
    expect(first.result.current.conflict).toBe(false)
    expect(second.result.current.conflict).toBe(false)
  })

  it('keeps the note open for the second holder when the first unmounts', async () => {
    const first = renderHook(() => useNote(PATH))
    const second = renderHook(() => useNote(PATH))
    await waitFor(() => expect(second.result.current.isLoading).toBe(false))

    act(() => first.result.current.save('# A\nx'))
    first.unmount()
    await vi.advanceTimersByTimeAsync(0)

    expect(api.assets.gc).not.toHaveBeenCalledWith(PATH, expect.anything())
    expect(second.result.current.content).toBe('# A\nx')
    second.unmount()
    await waitFor(() => expect(api.assets.gc).toHaveBeenCalledWith(PATH, '# A\nx'))
  })
})
