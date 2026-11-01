import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useReportDirtyPaths } from './useReportDirtyPaths'
import { useDirtyPathsStore } from '../store/dirtyPaths'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'

vi.mock('../lib/tauri', () => ({
  api: { cli: { reportDirtyPaths: vi.fn() } },
}))

const report = vi.mocked(api.cli.reportDirtyPaths)

describe('useReportDirtyPaths', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    report.mockResolvedValue(undefined)
    useDirtyPathsStore.setState({ paths: new Set() })
    useWorkspaceStore.setState({ path: '/ws' })
  })

  it('reports the dirty set to the backend whenever it changes', () => {
    renderHook(() => useReportDirtyPaths())
    act(() => useDirtyPathsStore.getState().markDirty('/ws/a.md'))
    expect(report).toHaveBeenLastCalledWith('/ws', ['/ws/a.md'])
    act(() => useDirtyPathsStore.getState().markClean('/ws/a.md'))
    expect(report).toHaveBeenLastCalledWith('/ws', [])
  })

  it('swallows a backend that has no such command', () => {
    report.mockRejectedValue(new Error('not available'))
    renderHook(() => useReportDirtyPaths())
    expect(() => act(() => useDirtyPathsStore.getState().markDirty('/ws/a.md'))).not.toThrow()
  })

  it('clears the old workspace when the workspace changes under a report', () => {
    renderHook(() => useReportDirtyPaths())
    act(() => useDirtyPathsStore.getState().markDirty('/ws/a.md'))
    useWorkspaceStore.setState({ path: '/other' })
    act(() => useDirtyPathsStore.getState().markClean('/ws/a.md'))
    expect(report).toHaveBeenCalledWith('/ws', [])
    expect(report).toHaveBeenLastCalledWith('/other', [])
  })
})
