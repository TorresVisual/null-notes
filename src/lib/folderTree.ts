import type { NoteMetadata } from '../types'

export interface FolderTreeNode {
  type: 'folder'
  name: string
  path: string
  children: TreeEntry[]
}

export interface NoteTreeNode {
  type: 'note'
  name: string
  path: string
  note: NoteMetadata
}

export type TreeEntry = FolderTreeNode | NoteTreeNode

interface MutableFolder {
  name: string
  path: string
  folders: Map<string, MutableFolder>
  notes: NoteMetadata[]
}

function relativeSegments(root: string, path: string): string[] {
  const normalizedRoot = root.replace(/[\\/]+$/, '')
  const rest = path.slice(normalizedRoot.length).replace(/^[\\/]+/, '')
  return rest.split(/[\\/]+/).filter(Boolean)
}

function ensureFolder(root: MutableFolder, segments: string[]): MutableFolder {
  let current = root
  let currentPath = root.path
  for (const segment of segments) {
    currentPath = `${currentPath}/${segment}`
    let next = current.folders.get(segment)
    if (!next) {
      next = { name: segment, path: currentPath, folders: new Map(), notes: [] }
      current.folders.set(segment, next)
    }
    current = next
  }
  return current
}

function toTreeEntries(folder: MutableFolder): TreeEntry[] {
  const folderEntries: FolderTreeNode[] = [...folder.folders.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((f) => ({ type: 'folder', name: f.name, path: f.path, children: toTreeEntries(f) }))

  const noteEntries: NoteTreeNode[] = [...folder.notes]
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((n) => ({ type: 'note', name: n.title, path: n.path, note: n }))

  return [...folderEntries, ...noteEntries]
}

export function buildFolderTree(
  root: string,
  folders: string[],
  notes: NoteMetadata[],
): TreeEntry[] {
  const rootFolder: MutableFolder = { name: '', path: root, folders: new Map(), notes: [] }

  for (const folderPath of folders) {
    const segments = relativeSegments(root, folderPath)
    if (segments.length > 0) {
      ensureFolder(rootFolder, segments)
    }
  }

  for (const noteItem of notes) {
    const segments = relativeSegments(root, noteItem.path)
    const noteName = segments.pop()
    if (noteName === undefined) continue
    const parent = ensureFolder(rootFolder, segments)
    parent.notes.push(noteItem)
  }

  return toTreeEntries(rootFolder)
}
