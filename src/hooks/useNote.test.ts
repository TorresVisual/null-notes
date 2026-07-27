import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useNote, SAVE_DEBOUNCE_MS, REINDEX_DEBOUNCE_MS } from './useNote'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'

vi.mock('../lib/tauri', () => ({
  api: {
    notes: {
      open: vi.fn(),
      save: vi.fn(),
      reindex: vi.fn(),
    },
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
const PAST_SAVE = SAVE_DEBOUNCE_MS + 100
const PAST_REINDEX = REINDEX_DEBOUNCE_MS + 100

async function mountNote(path = '/ws/note.md') {
  const hook = renderHook(() => useNote(path))
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false))
  return hook
}

describe('useNote', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    useWorkspaceStore.setState({ path: '/ws' })
    notes.open.mockResolvedValue('# Note\n')
    notes.save.mockResolvedValue(undefined)
    notes.reindex.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('coalesces rapid edits into a single save', async () => {
    const { result } = await mountNote()

    act(() => {
      result.current.save('# Note\na')
      result.current.save('# Note\nab')
      result.current.save('# Note\nabc')
    })
    expect(notes.save).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAST_SAVE)
    })

    expect(notes.save).toHaveBeenCalledTimes(1)
    expect(notes.save).toHaveBeenCalledWith('/ws/note.md', '# Note\nabc')
  })

  it('reports dirty while typing and clean once the write lands', async () => {
    const { result } = await mountNote()

    act(() => result.current.save('# Note\nedited'))
    expect(result.current.saveState).toBe('dirty')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAST_SAVE)
    })
    expect(result.current.saveState).toBe('clean')
  })

  it('writes the pending edit when the note is closed before the debounce fires', async () => {
    const { result, unmount } = await mountNote()

    act(() => result.current.save('# Note\ntrailing keystrokes'))
    unmount()

    await waitFor(() =>
      expect(notes.save).toHaveBeenCalledWith('/ws/note.md', '# Note\ntrailing keystrokes'),
    )
  })

  it('reindexes after the file write, on a lazier schedule', async () => {
    const { result } = await mountNote()

    act(() => result.current.save('# Note\nindexed'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAST_SAVE)
    })
    expect(notes.reindex).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAST_REINDEX)
    })
    expect(notes.reindex).toHaveBeenCalledWith('/ws/note.md', '/ws', '# Note\nindexed')
  })

  it('keeps the buffer dirty and surfaces the error when a save fails', async () => {
    const { result } = await mountNote()
    notes.save.mockRejectedValueOnce('disk full')

    act(() => result.current.save('# Note\nunlucky'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAST_SAVE)
    })

    expect(result.current.saveState).toBe('error')
    expect(result.current.saveError).toContain('disk full')

    await act(async () => {
      await result.current.retrySave()
    })

    expect(notes.save).toHaveBeenLastCalledWith('/ws/note.md', '# Note\nunlucky')
    expect(result.current.saveState).toBe('clean')
  })

  it('follows the disk when the note changes externally and the buffer is clean', async () => {
    const { result } = await mountNote()
    notes.open.mockResolvedValue('# Note\nedited in vim')

    await act(async () => {
      await emitWorkspaceChanged({ payload: ['/ws/note.md'] })
    })

    expect(result.current.content).toBe('# Note\nedited in vim')
    expect(result.current.conflict).toBe(false)
  })

  // The watcher reports our own writes too, and it lags them. Typing on past a
  // save leaves the disk holding the previous version — that is not a conflict.
  it('does not prompt when the watcher reports our own earlier write', async () => {
    const { result } = await mountNote()

    act(() => result.current.save('# Note\nfirst'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAST_SAVE)
    })
    expect(notes.save).toHaveBeenLastCalledWith('/ws/note.md', '# Note\nfirst')

    act(() => result.current.save('# Note\nfirst and more'))
    notes.open.mockResolvedValue('# Note\nfirst')
    await act(async () => {
      await emitWorkspaceChanged({ payload: ['/ws/note.md'] })
    })

    expect(result.current.conflict).toBe(false)
    expect(result.current.content).toBe('# Note\nfirst and more')
  })

  it('prompts instead of clobbering when the buffer is dirty', async () => {
    const { result } = await mountNote()

    act(() => result.current.save('# Note\nmy unsaved work'))
    notes.open.mockResolvedValue('# Note\ntheir version')
    await act(async () => {
      await emitWorkspaceChanged({ payload: ['/ws/note.md'] })
    })

    expect(result.current.conflict).toBe(true)
    expect(result.current.content).toBe('# Note\nmy unsaved work')

    act(() => result.current.reloadTheirs())

    expect(result.current.conflict).toBe(false)
    expect(result.current.content).toBe('# Note\ntheir version')
    expect(result.current.saveState).toBe('clean')
  })

  it('keeping mine writes the local buffer over the external change', async () => {
    const { result } = await mountNote()

    act(() => result.current.save('# Note\nmine wins'))
    notes.open.mockResolvedValue('# Note\ntheirs')
    await act(async () => {
      await emitWorkspaceChanged({ payload: ['/ws/note.md'] })
    })
    expect(result.current.conflict).toBe(true)

    await act(async () => {
      result.current.keepMine()
      await vi.advanceTimersByTimeAsync(PAST_SAVE)
    })

    expect(notes.save).toHaveBeenLastCalledWith('/ws/note.md', '# Note\nmine wins')
    expect(result.current.conflict).toBe(false)
  })

  it('dismissing a save error leaves the note marked unsaved, never saved', async () => {
    const { result } = await mountNote()
    notes.save.mockRejectedValue('permission denied')

    act(() => result.current.save('# Note\nstill unsaved'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAST_SAVE)
    })
    expect(result.current.saveState).toBe('error')

    act(() => result.current.dismissError())

    expect(result.current.saveError).toBeNull()
    expect(result.current.saveState).toBe('dirty')
  })
})
