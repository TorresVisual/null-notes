import type { NoteMetadata } from '../types'
import { folderName } from './pathPrefix'

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

export interface CanvasTreeNode {
  type: 'canvas'
  name: string
  path: string
}

export type TreeEntry = FolderTreeNode | NoteTreeNode | CanvasTreeNode

interface MutableFolder {
  name: string
  path: string
  folders: Map<string, MutableFolder>
  notes: NoteMetadata[]
  canvases: string[]
}

function relativeSegments(root: string, path: string): string[] {
  const normalizedRoot = root.replace(/[\\/]+$/, '')
  const rest = path.slice(normalizedRoot.length).replace(/^[\\/]+/, '')
  return rest.split(/[\\/]+/).filter(Boolean)
}

function ensureFolder(root: MutableFolder, segments: string[], separator: string): MutableFolder {
  let current = root
  let currentPath = root.path
  for (const segment of segments) {
    currentPath = `${currentPath}${separator}${segment}`
    let next = current.folders.get(segment)
    if (!next) {
      next = { name: segment, path: currentPath, folders: new Map(), notes: [], canvases: [] }
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

  const canvasEntries: CanvasTreeNode[] = folder.canvases
    .map((path) => ({ type: 'canvas' as const, name: folderName(path).replace(/\.canvas$/, ''), path }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return [...folderEntries, ...noteEntries, ...canvasEntries]
}

export function buildFolderTree(
  root: string,
  folders: string[],
  notes: NoteMetadata[],
  canvases: string[] = [],
): TreeEntry[] {
  // Reconstructed folder paths must use the same separator as the root
  // (backslash on Windows) so they round-trip byte-for-byte through
  // backend commands like create_note — a note created "in" a folder
  // whose path mixes '/' into a Windows root gets a path string a later
  // filesystem scan won't recognize as the same file.
  const separator = root.includes('\\') ? '\\' : '/'
  const rootFolder: MutableFolder = { name: '', path: root, folders: new Map(), notes: [], canvases: [] }

  for (const folderPath of folders) {
    const segments = relativeSegments(root, folderPath)
    if (segments.length > 0) {
      ensureFolder(rootFolder, segments, separator)
    }
  }

  for (const noteItem of notes) {
    const segments = relativeSegments(root, noteItem.path)
    const noteName = segments.pop()
    if (noteName === undefined) continue
    const parent = ensureFolder(rootFolder, segments, separator)
    parent.notes.push(noteItem)
  }

  for (const canvasPath of canvases) {
    const segments = relativeSegments(root, canvasPath)
    segments.pop()
    ensureFolder(rootFolder, segments, separator).canvases.push(canvasPath)
  }

  return toTreeEntries(rootFolder)
}
