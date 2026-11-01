import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { BaseRow } from '../types'
import { useBaseRowsStore } from './baseRows'
import { api } from '../lib/tauri'

vi.mock('../lib/tauri', () => ({
  api: { properties: { listRows: vi.fn() } },
}))

function row(path: string, properties: Record<string, unknown>): BaseRow {
  return { path, title: path, properties, parseError: null, ctime: 0, mtime: 0, size: 0, tags: [], links: [], backlinks: [] }
}

describe('useBaseRowsStore', () => {
  beforeEach(() => {
    useBaseRowsStore.setState({ rows: [], workspace: null })
  })

  it('loads the rows for a workspace', async () => {
    vi.mocked(api.properties.listRows).mockResolvedValue([row('/ws/a.md', { s: 1 })])
    await useBaseRowsStore.getState().load('/ws')
    expect(useBaseRowsStore.getState().rows).toHaveLength(1)
    expect(useBaseRowsStore.getState().workspace).toBe('/ws')
  })

  it('patch updates one row only, and undefined removes the key', () => {
    useBaseRowsStore.setState({ rows: [row('/ws/a.md', { s: 1, t: 2 }), row('/ws/b.md', { s: 1 })] })
    useBaseRowsStore.getState().patch('/ws/a.md', 's', 5)
    useBaseRowsStore.getState().patch('/ws/a.md', 't', undefined)
    const [a, b] = useBaseRowsStore.getState().rows
    expect(a?.properties).toEqual({ s: 5 })
    expect(b?.properties).toEqual({ s: 1 })
  })
})
