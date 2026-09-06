import { useEffect } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { folderName } from '../lib/pathPrefix'
import { useNotesStore, noteTitle } from '../store/notes'

export function useWindowTitle(workspacePath: string | null, activeTab: string | null): string {
  const notes = useNotesStore((s) => s.notes)
  const title = [
    activeTab ? noteTitle(notes, activeTab) : null,
    workspacePath ? folderName(workspacePath) : null,
    'null-notes',
  ]
    .filter((p): p is string => p !== null)
    .join(' — ')

  useEffect(() => {
    getCurrentWindow().setTitle(title)
  }, [title])

  return title
}
