import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useCanvas } from './useCanvas'
import { SAVE_DEBOUNCE_MS } from './useNote'
import { flushAllCanvases } from '../lib/canvasFlush'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'
import { serializeCanvas, type Canvas, type CanvasNode } from '../lib/jsonCanvas'

vi.mock('../lib/tauri', () => ({
  api: { notes: { open: vi.fn(), save: vi.fn() } },
}))

type ChangeHandler = (event: { payload: string[] }) => void | Promise<void>
let emitCanvasChanged: ChangeHandler = () => {}

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((_event: string, handler: ChangeHandler) => {
    emitCanvasChanged = handler
    return Promise.resolve(() => {})
  }),
}))

const notes = vi.mocked(api.notes)
const PATH = '/ws/map.canvas'
const PAST_SAVE = SAVE_DEBOUNCE_MS + 100

function node(id: string, x = 0, y = 0, extra: Partial<CanvasNode> = {}): CanvasNode {
  return { id, type: 'text', x, y, width: 100, height: 50, ...extra }
}

function canvas(nodes: CanvasNode[], lastPass = 1): Canvas {
  return { nodes, edges: [], lastPass }
}

const passTwo = [
  node('g2', 0, 400, { type: 'group', pass: 2, author: 'agent' }),
  node('q2', 10, 410, { pass: 2, author: 'agent' }),
]

let disk = ''

function setDisk(next: Canvas) {
  disk = serializeCanvas(next)
}

async function mountCanvas() {
  const hook = renderHook(() => useCanvas(PATH))
  await waitFor(() => expect(hook.result.current.canvas).not.toBeNull())
  return hook
}

async function externalChange() {
  await act(async () => {
    await emitCanvasChanged({ payload: [PATH] })
  })
}

async function pastSave() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(PAST_SAVE)
  })
}

describe('useCanvas', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    useWorkspaceStore.setState({ path: '/ws', gitPendingPaths: [] })
    setDisk(canvas([node('a'), node('b', 200, 0)]))
    notes.open.mockImplementation(async () => disk)
    notes.save.mockImplementation(async (_ws, _path, content) => {
      disk = content
    })
  })

  afterEach(async () => {
    // Unmounting flushes a dirty buffer; let that land before the next test's mocks start.
    cleanup()
    await vi.advanceTimersByTimeAsync(50)
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('does not raise a conflict when our own save echoes back', async () => {
    const { result } = await mountCanvas()
    act(() => result.current.update(canvas([node('a', 5, 5), node('b', 200, 0)])))
    await pastSave()
    expect(notes.save).toHaveBeenCalledTimes(1)

    await externalChange()

    expect(result.current.conflict).toBe(false)
    expect(result.current.saveState).toBe('clean')
    expect(useWorkspaceStore.getState().gitPendingPaths).toContain(PATH)
  })

  it('merges a pass the agent appended while the buffer is dirty', async () => {
    const { result } = await mountCanvas()
    act(() => result.current.update(canvas([node('a', 40, 40), node('b', 200, 0)])))
    setDisk(canvas([node('a'), node('b', 200, 0), ...passTwo], 2))

    await externalChange()

    expect(result.current.conflict).toBe(false)
    expect(result.current.canvas?.nodes.map((n) => n.id)).toEqual(['a', 'b', 'g2', 'q2'])
    expect(result.current.canvas?.nodes[0]).toMatchObject({ x: 40, y: 40 })
    expect(result.current.appendedPasses).toEqual([2])
    expect(notes.save).not.toHaveBeenCalled()
  })

  it('raises a conflict and writes nothing when both sides moved the same card', async () => {
    const { result } = await mountCanvas()
    act(() => result.current.update(canvas([node('a', 1, 1), node('b', 200, 0)])))
    setDisk(canvas([node('a', 2, 2), node('b', 200, 0)]))

    await externalChange()
    await pastSave()

    expect(result.current.conflict).toBe(true)
    expect(notes.save).not.toHaveBeenCalled()
  })

  it('merges in a pass that landed on disk after our last read, at save time', async () => {
    const { result } = await mountCanvas()
    act(() => result.current.update(canvas([node('a', 40, 40), node('b', 200, 0)])))
    setDisk(canvas([node('a'), node('b', 200, 0), ...passTwo], 2))

    await pastSave()

    expect(notes.save).toHaveBeenCalledTimes(1)
    const written = notes.save.mock.calls[0]?.[2] ?? ''
    expect(written).toContain('"q2"')
    expect(written).toContain('"x": 40')
    expect(result.current.canvas?.nodes.map((n) => n.id)).toContain('q2')
  })

  it('is read-only and never saves when the file is malformed', async () => {
    disk = '{ not json'
    const { result } = renderHook(() => useCanvas(PATH))
    await waitFor(() => expect(result.current.error).not.toBeNull())

    expect(result.current.readOnly).toBe(true)
    act(() => result.current.update(canvas([node('a')])))
    await pastSave()

    expect(notes.save).not.toHaveBeenCalled()
  })

  it('reloadTheirs adopts the disk version and clears the conflict', async () => {
    const { result } = await mountCanvas()
    act(() => result.current.update(canvas([node('a', 1, 1), node('b', 200, 0)])))
    setDisk(canvas([node('a', 2, 2), node('b', 200, 0)]))
    await externalChange()

    act(() => result.current.reloadTheirs())
    await pastSave()

    expect(result.current.conflict).toBe(false)
    expect(result.current.canvas?.nodes[0]).toMatchObject({ x: 2, y: 2 })
    expect(notes.save).not.toHaveBeenCalled()
  })

  it('keepMine overwrites the disk version with the buffer', async () => {
    const { result } = await mountCanvas()
    act(() => result.current.update(canvas([node('a', 1, 1), node('b', 200, 0)])))
    setDisk(canvas([node('a', 2, 2), node('b', 200, 0)]))
    await externalChange()

    act(() => result.current.keepMine())
    await pastSave()

    expect(result.current.conflict).toBe(false)
    expect(notes.save).toHaveBeenCalledTimes(1)
    expect(disk).toContain('"x": 1')
  })

  it('keepMine keeps my card on a clash but does not erase the pass the agent added', async () => {
    const { result } = await mountCanvas()
    act(() => result.current.update(canvas([node('a', 1, 1), node('b', 200, 0)])))
    setDisk(canvas([node('a', 2, 2), node('b', 200, 0), ...passTwo], 2))
    await externalChange()
    expect(result.current.conflict).toBe(true)

    act(() => result.current.keepMine())
    await pastSave()

    expect(disk).toContain('"x": 1')
    expect(disk).toContain('"q2"')
    expect(result.current.canvas?.nodes.map((n) => n.id)).toContain('q2')
  })

  it('reloadTheirs takes their card on a clash but keeps my unrelated edit', async () => {
    const { result } = await mountCanvas()
    act(() => result.current.update(canvas([node('a', 1, 1), node('b', 55, 55)])))
    setDisk(canvas([node('a', 2, 2), node('b', 200, 0)]))
    await externalChange()
    expect(result.current.conflict).toBe(true)

    act(() => result.current.reloadTheirs())
    await pastSave()

    expect(result.current.canvas?.nodes[0]).toMatchObject({ x: 2, y: 2 })
    expect(result.current.canvas?.nodes[1]).toMatchObject({ x: 55, y: 55 })
    expect(disk).toContain('"x": 55')
  })

  it('undoes and redoes through the debounced save', async () => {
    const { result } = await mountCanvas()
    const one = canvas([node('a', 1, 1), node('b', 200, 0)])
    const two = canvas([node('a', 2, 2), node('b', 200, 0)])
    act(() => result.current.update(one))
    act(() => result.current.update(two))

    act(() => result.current.undo())
    expect(result.current.canvas).toEqual(one)
    expect(result.current.canRedo).toBe(true)

    act(() => result.current.redo())
    expect(result.current.canvas).toEqual(two)
    await pastSave()
    expect(notes.save).toHaveBeenCalledTimes(1)
  })

  it('clears undo history when an external pass arrives so undo cannot delete it', async () => {
    const { result } = await mountCanvas()
    act(() => result.current.update(canvas([node('a', 1, 1), node('b', 200, 0)])))
    expect(result.current.canUndo).toBe(true)
    setDisk(canvas([node('a'), node('b', 200, 0), ...passTwo], 2))

    await externalChange()
    expect(result.current.canUndo).toBe(false)

    act(() => result.current.undo())
    expect(result.current.canvas?.nodes.map((n) => n.id)).toContain('q2')
  })
})

describe('useCanvas on window close', () => {
  it('flushAllCanvases saves a dirty canvas without waiting for the debounce', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    useWorkspaceStore.setState({ path: '/ws', gitPendingPaths: [] })
    setDisk(canvas([node('a'), node('b', 200, 0)]))
    notes.open.mockImplementation(async () => disk)
    notes.save.mockImplementation(async (_ws, _path, content) => {
      disk = content
    })
    const { result } = await mountCanvas()
    act(() => result.current.update(canvas([node('a', 9, 9), node('b', 200, 0)])))
    expect(notes.save).not.toHaveBeenCalled()

    await act(async () => {
      await flushAllCanvases()
    })

    expect(notes.save).toHaveBeenCalledTimes(1)
    expect(disk).toContain('"x": 9')
    cleanup()
    await vi.advanceTimersByTimeAsync(50)
    vi.useRealTimers()
    vi.clearAllMocks()
  })
})
