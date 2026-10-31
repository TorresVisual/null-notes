import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { NoteMetadata } from '../types'

vi.mock('../lib/tauri', () => ({
  api: { notes: { open: vi.fn() } },
}))

type ChangeHandler = (event: { payload: string[] }) => void | Promise<void>
let emitWorkspaceChanged: ChangeHandler = () => {}
const unlisten = vi.fn()

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((_event: string, handler: ChangeHandler) => {
    emitWorkspaceChanged = handler
    return Promise.resolve(unlisten)
  }),
}))

const { api } = await import('../lib/tauri')
const { useEmbedSource } = await import('./useEmbedSource')
const openNote = vi.mocked(api.notes.open)

const target: NoteMetadata = { id: '1', title: 'B', path: '/ws/b.md', workspace: '/ws', updatedAt: 0 }

beforeEach(() => {
  openNote.mockReset()
  unlisten.mockReset()
})

describe('useEmbedSource', () => {
  it('returns null and never opens anything for an undefined target', () => {
    const { result } = renderHook(() => useEmbedSource(undefined))

    expect(result.current).toBeNull()
    expect(openNote).not.toHaveBeenCalled()
  })

  it('returns the opened content', async () => {
    openNote.mockResolvedValue('# B\nhello')
    const { result } = renderHook(() => useEmbedSource(target))

    await waitFor(() => expect(result.current).toBe('# B\nhello'))
    expect(openNote).toHaveBeenCalledWith('/ws', '/ws/b.md')
  })

  it('refetches only when workspace-changed names the target', async () => {
    openNote.mockResolvedValue('v1')
    const { result } = renderHook(() => useEmbedSource(target))
    await waitFor(() => expect(result.current).toBe('v1'))

    openNote.mockResolvedValue('v2')
    await act(async () => {
      await emitWorkspaceChanged({ payload: ['/ws/other.md'] })
    })
    expect(openNote).toHaveBeenCalledTimes(1)

    await act(async () => {
      await emitWorkspaceChanged({ payload: ['/ws/b.md'] })
    })
    await waitFor(() => expect(result.current).toBe('v2'))
  })

  it('survives a failed refetch without an unhandled rejection and drops stale content', async () => {
    openNote.mockResolvedValue('v1')
    const { result } = renderHook(() => useEmbedSource(target))
    await waitFor(() => expect(result.current).toBe('v1'))

    openNote.mockRejectedValue(new Error('gone'))
    await act(async () => {
      await emitWorkspaceChanged({ payload: ['/ws/b.md'] })
    })

    await waitFor(() => expect(result.current).toBeNull())
  })

  it('keeps the newest response when two loads overlap', async () => {
    let resolveFirst: (v: string) => void = () => {}
    openNote.mockImplementationOnce(() => new Promise<string>((r) => { resolveFirst = r }))
    const { result } = renderHook(() => useEmbedSource(target))
    openNote.mockResolvedValue('new')
    await act(async () => {
      await emitWorkspaceChanged({ payload: ['/ws/b.md'] })
    })
    await waitFor(() => expect(result.current).toBe('new'))

    await act(async () => {
      resolveFirst('old')
    })

    expect(result.current).toBe('new')
  })

  it('stops listening on unmount', async () => {
    openNote.mockResolvedValue('v1')
    const { result, unmount } = renderHook(() => useEmbedSource(target))
    await waitFor(() => expect(result.current).toBe('v1'))

    unmount()

    await waitFor(() => expect(unlisten).toHaveBeenCalled())
  })
})
