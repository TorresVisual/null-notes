import { isUnderPath } from './pathPrefix'
import type { TreeEntry } from './folderTree'

export function visibleTreePaths(entries: TreeEntry[], expandedFolders: string[]): string[] {
  return entries.flatMap((entry) => {
    if (entry.type === 'canvas') return []
    if (entry.type === 'note') return [entry.path]
    return [entry.path, ...(expandedFolders.includes(entry.path) ? visibleTreePaths(entry.children, expandedFolders) : [])]
  })
}

export function toggleSelection(selected: string[], path: string): string[] {
  return selected.includes(path) ? selected.filter((p) => p !== path) : [...selected, path]
}

export function rangeSelection(visible: string[], anchor: string | null, path: string): string[] {
  const from = anchor === null ? -1 : visible.indexOf(anchor)
  const to = visible.indexOf(path)
  if (from === -1 || to === -1) return [path]
  return visible.slice(Math.min(from, to), Math.max(from, to) + 1)
}

// A folder and something inside it both selected must move/delete once, as the
// folder — acting on the child too would hit a path the parent already took.
export function topLevelPaths(selected: string[]): string[] {
  return selected.filter((p) => !selected.some((other) => other !== p && isUnderPath(p, other)))
}
