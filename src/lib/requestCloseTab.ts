import { confirm } from '@tauri-apps/plugin-dialog'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore, noteTitle } from '../store/notes'

/** User-initiated close (tab ✕, Ctrl+W, context menu). A pinned tab is kept
 *  on purpose, so closing it asks first; programmatic closes (a deleted
 *  note or folder) call the store's `closeTab` directly and never prompt. */
export async function requestCloseTab(notePath: string): Promise<void> {
  const { pinnedTabs, closeTab } = useWorkspaceStore.getState()
  if (pinnedTabs.includes(notePath)) {
    const title = noteTitle(useNotesStore.getState().notes, notePath)
    if (!(await confirm(`Close pinned tab "${title}"?`))) return
  }
  closeTab(notePath)
}
