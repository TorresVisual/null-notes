import { useCallback } from 'react'
import { api } from '../lib/tauri'
import { useBaseRowsStore } from '../store/baseRows'
import { showToast } from '../store/toast'
import { useWorkspaceStore } from '../store/workspace'
import type { BaseRow } from '../types'

function describeChange(key: string, value: unknown): string {
  if (value === undefined) return `Cleared ${key}`
  return `Set ${key} to ${Array.isArray(value) ? value.join(', ') : String(value)}`
}

async function write(path: string, key: string, expected: unknown, value: unknown, isUndo: boolean): Promise<void> {
  const workspace = useWorkspaceStore.getState().path
  if (!workspace) return
  const { patch } = useBaseRowsStore.getState()
  patch(path, key, value)
  try {
    await api.properties.writeProperty(workspace, path, key, expected, value)
    useWorkspaceStore.getState().addGitPendingPath(path)
    if (!isUndo) {
      showToast(describeChange(key, value), {
        label: 'Undo',
        onClick: () => void write(path, key, value, expected, true),
      })
    }
  } catch (e) {
    patch(path, key, expected)
    const message = e instanceof Error ? e.message : String(e)
    if (message.startsWith('STALE:')) {
      showToast(isUndo ? "Note changed since — can't undo" : 'Note changed since — reload')
    } else {
      showToast(`Couldn't update ${key}: ${message}`)
    }
  }
}

// `expected` is what the view displayed; the backend refuses the write if the
// note on disk no longer holds it, so a stale view never overwrites an edit.
export function usePropertyWrite(): (row: BaseRow, key: string, value: unknown) => Promise<void> {
  return useCallback((row, key, value) => write(row.path, key, row.properties[key], value, false), [])
}
