import type { NoteMetadata } from '../types'
import { isUnderPath } from './pathPrefix'

export interface ScopeFolder {
  name: string
  path: string
  noteCount: number
}

export function topLevelFolders(workspace: string, folders: string[], notes: NoteMetadata[]): ScopeFolder[] {
  const separator = workspace.includes('\\') ? '\\' : '/'
  const top = new Set<string>()
  for (const folder of folders) {
    if (!isUnderPath(folder, workspace) || folder === workspace) continue
    const name = folder.slice(workspace.length).split(/[\\/]/).filter(Boolean)[0]
    if (name && !name.startsWith('.')) top.add(name)
  }
  return [...top]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .map((name) => {
      const path = `${workspace}${separator}${name}`
      return { name, path, noteCount: notes.filter((n) => isUnderPath(n.path, path)).length }
    })
}

// The trailing separator keeps "Algorithms" from also matching "Algorithms 2",
// since `notes_in_scope` filters by substring.
export function folderScopeArg(folderPath: string): string {
  return `${folderPath}${folderPath.includes('\\') ? '\\' : '/'}`
}
