import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { BaseRow } from '../types'
import { usePropertyWrite } from './usePropertyWrite'
import { useBaseRowsStore } from '../store/baseRows'
import { useToastStore } from '../store/toast'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'

vi.mock('../lib/tauri', () => ({
  api: { properties: { writeProperty: vi.fn() } },
}))

const write = vi.mocked(api.properties.writeProperty)

function row(properties: Record<string, unknown>): BaseRow {
  return { path: '/ws/a.md', title: 'A', properties, parseError: null, ctime: 0, mtime: 0, size: 0, tags: [], links: [], backlinks: [] }
}

describe('usePropertyWrite', () => {
  beforeEach(() => {
    write.mockReset()
    write.mockResolvedValue(undefined)
    useToastStore.setState({ toasts: [] })
    useWorkspaceStore.setState({ path: '/ws', gitPendingPaths: [] })
    useBaseRowsStore.setState({ rows: [row({ status: 'todo' })], workspace: '/ws' })
  })

  it('patches optimistically, writes with the displayed value as expected, and offers Undo', async () => {
    const { result } = renderHook(() => usePropertyWrite())
    await result.current(row({ status: 'todo' }), 'status', 'done')

    expect(write).toHaveBeenCalledWith('/ws', '/ws/a.md', 'status', 'todo', 'done')
    expect(useBaseRowsStore.getState().rows[0]?.properties.status).toBe('done')
    const toast = useToastStore.getState().toasts[0]
    expect(toast?.action?.label).toBe('Undo')
  })

  it('Undo writes the old value back with swapped expected and value', async () => {
    const { result } = renderHook(() => usePropertyWrite())
    await result.current(row({ status: 'todo' }), 'status', 'done')
    write.mockClear()

    useToastStore.getState().toasts[0]?.action?.onClick()
    await vi.waitFor(() => expect(write).toHaveBeenCalledWith('/ws', '/ws/a.md', 'status', 'done', 'todo'))
    await vi.waitFor(() => expect(useBaseRowsStore.getState().rows[0]?.properties.status).toBe('todo'))
  })

  it('reverts the optimistic patch and says so when the note changed', async () => {
    write.mockRejectedValue('STALE: "status" changed since the view loaded')
    const { result } = renderHook(() => usePropertyWrite())
    await result.current(row({ status: 'todo' }), 'status', 'done')

    expect(useBaseRowsStore.getState().rows[0]?.properties.status).toBe('todo')
    expect(useToastStore.getState().toasts[0]?.message).toMatch(/changed since/i)
    expect(useToastStore.getState().toasts[0]?.action).toBeUndefined()
  })

  it('reverts and reports any other error', async () => {
    write.mockRejectedValue('disk full')
    const { result } = renderHook(() => usePropertyWrite())
    await result.current(row({ status: 'todo' }), 'status', 'done')

    expect(useBaseRowsStore.getState().rows[0]?.properties.status).toBe('todo')
    expect(useToastStore.getState().toasts[0]?.message).toContain('disk full')
  })
})
