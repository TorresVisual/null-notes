import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useBase } from './useBase'
import { SAVE_DEBOUNCE_MS } from './useNote'
import { renameView } from '../lib/baseFile'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'

vi.mock('../lib/tauri', () => ({
  api: { notes: { open: vi.fn(), save: vi.fn() } },
}))

type ChangeHandler = (event: { payload: string[] }) => void | Promise<void>
let emitChanged: ChangeHandler = () => {}

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((_event: string, handler: ChangeHandler) => {
    emitChanged = handler
    return Promise.resolve(() => {})
  }),
}))

const notes = vi.mocked(api.notes)
const PATH = '/ws/Tasks.base'
const VALID = 'views:\n  - type: table\n    name: Table\n'
let disk = VALID

async function pastSave() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 100)
  })
}

describe('useBase', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    useWorkspaceStore.setState({ path: '/ws', gitPendingPaths: [] })
    disk = VALID
    notes.open.mockImplementation(async () => disk)
    notes.save.mockReset()
    notes.save.mockImplementation(async (_ws, _path, content) => {
      disk = content
    })
  })

  afterEach(async () => {
    cleanup()
    await vi.advanceTimersByTimeAsync(50)
    vi.useRealTimers()
  })

  it('loads a valid base', async () => {
    const { result } = renderHook(() => useBase(PATH))
    await waitFor(() => expect(result.current.base).not.toBeNull())
    expect(result.current.base?.views[0]?.name).toBe('Table')
    expect(result.current.error).toBeNull()
  })

  it('saves a structured edit after the debounce', async () => {
    const { result } = renderHook(() => useBase(PATH))
    await waitFor(() => expect(result.current.base).not.toBeNull())
    act(() => result.current.update((doc) => renameView(doc, 0, 'Renamed')))
    expect(result.current.base?.views[0]?.name).toBe('Renamed')
    await pastSave()
    expect(notes.save).toHaveBeenCalledWith('/ws', PATH, VALID.replace('Table', 'Renamed'))
  })

  it('saves edited source after the debounce', async () => {
    const { result } = renderHook(() => useBase(PATH))
    await waitFor(() => expect(result.current.base).not.toBeNull())
    act(() => result.current.setSource(`${VALID}# note\n`))
    await pastSave()
    expect(notes.save).toHaveBeenCalledWith('/ws', PATH, `${VALID}# note\n`)
  })

  it('sets error for a syntax-error file and update never saves', async () => {
    disk = 'views: [\n'
    const { result } = renderHook(() => useBase(PATH))
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.source).toBe('views: [\n')

    act(() => result.current.update(() => {}))
    await pastSave()
    expect(notes.save).not.toHaveBeenCalled()
  })

  it('invalid source is shown as an error and is not saved until fixed', async () => {
    const { result } = renderHook(() => useBase(PATH))
    await waitFor(() => expect(result.current.base).not.toBeNull())

    act(() => result.current.setSource('views: [\n'))
    await pastSave()
    expect(result.current.error).toMatch(/line/i)
    expect(notes.save).not.toHaveBeenCalled()

    act(() => result.current.setSource(VALID.replace('Table', 'Fixed')))
    await pastSave()
    expect(result.current.error).toBeNull()
    expect(notes.save).toHaveBeenCalledTimes(1)
  })

  it('adopts an external change when the buffer is clean', async () => {
    const { result } = renderHook(() => useBase(PATH))
    await waitFor(() => expect(result.current.base).not.toBeNull())
    disk = VALID.replace('Table', 'Other')
    await act(async () => {
      await emitChanged({ payload: [PATH] })
    })
    expect(result.current.base?.views[0]?.name).toBe('Other')
    expect(result.current.conflict).toBe(false)
  })

  it('raises a conflict instead of overwriting when the file changed under a dirty buffer', async () => {
    const { result } = renderHook(() => useBase(PATH))
    await waitFor(() => expect(result.current.base).not.toBeNull())
    act(() => result.current.setSource(VALID.replace('Table', 'Mine')))
    disk = VALID.replace('Table', 'Theirs')
    await pastSave()
    expect(notes.save).not.toHaveBeenCalled()
    expect(result.current.conflict).toBe(true)
    expect(disk).toContain('Theirs')

    act(() => result.current.reloadTheirs())
    await waitFor(() => expect(result.current.base?.views[0]?.name).toBe('Theirs'))
    expect(result.current.conflict).toBe(false)
  })

  it('ignores the echo of its own save', async () => {
    const { result } = renderHook(() => useBase(PATH))
    await waitFor(() => expect(result.current.base).not.toBeNull())
    act(() => result.current.setSource(VALID.replace('Table', 'Mine')))
    await pastSave()
    await act(async () => {
      await emitChanged({ payload: [PATH] })
    })
    expect(result.current.conflict).toBe(false)
    expect(result.current.base?.views[0]?.name).toBe('Mine')
  })
})
