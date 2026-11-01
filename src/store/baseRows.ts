import { create } from 'zustand'
import { api } from '../lib/tauri'
import type { BaseRow } from '../types'

interface BaseRowsStore {
  rows: BaseRow[]
  workspace: string | null
  load: (workspace: string) => Promise<void>
  /** Re-fetch for the workspace last loaded; a no-op while no base has been opened. */
  reload: () => Promise<void>
  /** Optimistic local edit; `undefined` removes the key. */
  patch: (path: string, key: string, value: unknown) => void
}

export const useBaseRowsStore = create<BaseRowsStore>((set, get) => ({
  rows: [],
  workspace: null,
  load: async (workspace) => {
    const rows = await api.properties.listRows(workspace)
    set({ rows, workspace })
  },
  reload: async () => {
    const { workspace, load } = get()
    if (workspace) await load(workspace)
  },
  patch: (path, key, value) =>
    set((s) => ({
      rows: s.rows.map((row) => {
        if (row.path !== path) return row
        const { [key]: _removed, ...rest } = row.properties
        return { ...row, properties: value === undefined ? rest : { ...row.properties, [key]: value } }
      }),
    })),
}))
