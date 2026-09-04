import { useEffect } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { folderName } from '../lib/pathPrefix'

// Mirrors TabBar's inline name derivation (path.split(/[\\/]/).pop()).
function noteName(path: string): string {
  return folderName(path).replace(/\.md$/, '')
}

export function useWindowTitle(workspacePath: string | null, activeTab: string | null): string {
  const title = [
    activeTab ? noteName(activeTab) : null,
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
