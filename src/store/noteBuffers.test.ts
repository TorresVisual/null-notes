import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from '@testing-library/react'
import {
  acquireNote,
  releaseNote,
  saveNote,
  flushAllNotes,
  useNoteBuffers,
  SAVE_DEBOUNCE_MS,
} from './noteBuffers'
import { useWorkspaceStore } from './workspace'
import { useDirtyPathsStore } from './dirtyPaths'
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
const A = '/ws/a.md'
const B = '/ws/b.md'
const PAST_SAVE = SAVE_DEBOUNCE_MS + 100
const maybeBuffer = (path: string) => useNoteBuffers.getState().buffers[path]
const buffer = (path: string) => {
  const b = maybeBuffer(path)
  if (!b) throw new Error('no buffer for ' + path)
  return b
}
const held: string[] = []

async function acquire(path: string) {
  held.push(path)
  acquireNote(path)
  await vi.waitFor(() => expect(maybeBuffer(path)?.isLoading).toBe(false))
}

describe('noteBuffers', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    useWorkspaceStore.setState({ path: '/ws' })
    useDirtyPathsStore.setState({ paths: new Set() })
    notes.open.mockResolvedValue('# Note\n')
    notes.save.mockResolvedValue(undefined)
    notes.reindex.mockResolvedValue(undefined)
  })

  afterEach(async () => {
    for (const path of held.splice(0)) for (let i = 0; i < 3; i++) releaseNote(path)
    await vi.advanceTimersByTimeAsync(0)
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('opens the note once however many holders acquire it', async () => {
    await acquire(A)
    await acquire(A)
    expect(notes.open).toHaveBeenCalledTimes(1)
    expect(buffer(A).content).toBe('# Note\n')
  })

  it('release of one of two holders neither flushes nor runs the asset gc', async () => {
    await acquire(A)
    await acquire(A)
    saveNote(A, '# Note\nx')

    releaseNote(A)
    await vi.advanceTimersByTimeAsync(0)

    expect(notes.save).not.toHaveBeenCalled()
    expect(api.assets.gc).not.toHaveBeenCalled()
    expect(buffer(A).content).toBe('# Note\nx')
  })

  it('release of the last holder flushes, then gcs against the content at release time', async () => {
    await acquire(A)
    saveNote(A, '# Note\n![i](a.assets/i.png)')

    releaseNote(A)

    await vi.waitFor(() =>
      expect(api.assets.gc).toHaveBeenCalledWith(A, '# Note\n![i](a.assets/i.png)'),
    )
    expect(notes.save).toHaveBeenCalledWith('/ws', A, '# Note\n![i](a.assets/i.png)')
    expect(maybeBuffer(A)).toBeUndefined()
  })

  it('does not gc a note that never loaded', async () => {
    notes.open.mockRejectedValue('bad utf-8')
    await acquire(A)
    releaseNote(A)
    await vi.advanceTimersByTimeAsync(0)
    expect(api.assets.gc).not.toHaveBeenCalled()
  })

  it('reacquiring a note waits for the previous holder’s flush before reading the disk', async () => {
    await acquire(A)
    let finishSave: () => void = () => {}
    notes.save.mockImplementationOnce(() => new Promise<void>((resolve) => (finishSave = resolve)))
    saveNote(A, '# Note\nlatest')
    releaseNote(A)
    await vi.advanceTimersByTimeAsync(0)

    acquireNote(A)
    await vi.advanceTimersByTimeAsync(0)
    expect(notes.open).toHaveBeenCalledTimes(1)

    notes.open.mockResolvedValue('# Note\nlatest')
    await act(async () => finishSave())
    await vi.waitFor(() => expect(buffer(A).content).toBe('# Note\nlatest'))
    expect(notes.open).toHaveBeenCalledTimes(2)
  })

  it('drops a save made before the note has loaded', async () => {
    notes.open.mockReturnValue(new Promise<string>(() => {}))
    held.push(A)
    acquireNote(A)
    saveNote(A, '# Other\n')
    await vi.advanceTimersByTimeAsync(PAST_SAVE)
    expect(notes.save).not.toHaveBeenCalled()
  })

  it('a failed open leaves the buffer empty and refuses saves', async () => {
    notes.open.mockRejectedValue('stream did not contain valid UTF-8')
    await acquire(A)
    expect(buffer(A).content).toBe('')
    expect(buffer(A).saveError).toMatch(/Couldn't open note/)

    saveNote(A, '# Overwrite\n')
    await vi.advanceTimersByTimeAsync(PAST_SAVE)
    expect(notes.save).not.toHaveBeenCalled()
  })

  it('keeps separate paths separate', async () => {
    notes.open.mockImplementation(async (_w, p) => (p === A ? '# A\n' : '# B\n'))
    await acquire(A)
    await acquire(B)
    saveNote(A, '# A\nedited')
    expect(buffer(B).content).toBe('# B\n')
    expect(buffer(B).saveState).toBe('clean')
  })

  it('raises no conflict when the watcher echoes our own write', async () => {
    await acquire(A)
    saveNote(A, '# Note\nfirst')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAST_SAVE)
    })
    saveNote(A, '# Note\nfirst and more')
    notes.open.mockResolvedValue('# Note\nfirst')
    await act(async () => {
      await emitWorkspaceChanged({ payload: [A] })
    })
    expect(buffer(A).conflict).toBe(false)
    expect(buffer(A).content).toBe('# Note\nfirst and more')
  })

  it('an external change on a dirty buffer sets conflict and holds autosave', async () => {
    await acquire(A)
    saveNote(A, '# Note\nmine')
    notes.open.mockResolvedValue('# Note\ntheirs')
    await act(async () => {
      await emitWorkspaceChanged({ payload: [A] })
      await vi.advanceTimersByTimeAsync(PAST_SAVE)
    })
    expect(buffer(A).conflict).toBe(true)
    expect(notes.save).not.toHaveBeenCalled()
  })

  it('flushAllNotes writes every dirty buffer', async () => {
    await acquire(A)
    await acquire(B)
    saveNote(A, '# A\nx')
    saveNote(B, '# B\ny')
    await flushAllNotes()
    expect(notes.save).toHaveBeenCalledWith('/ws', A, '# A\nx')
    expect(notes.save).toHaveBeenCalledWith('/ws', B, '# B\ny')
  })

  it('marks the path dirty until the write lands and forgets it on last release', async () => {
    await acquire(A)
    const dirty = () => useDirtyPathsStore.getState().paths.has(A)
    saveNote(A, '# Note\nx')
    expect(dirty()).toBe(true)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAST_SAVE)
    })
    expect(dirty()).toBe(false)

    saveNote(A, '# Note\ny')
    releaseNote(A)
    expect(dirty()).toBe(false)
  })
})
