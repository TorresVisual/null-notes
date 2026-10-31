import { describe, it, expect } from 'vitest'
import { buildFolderTree } from './folderTree'
import type { NoteMetadata } from '../types'

function note(title: string, path: string): NoteMetadata {
  return { id: title, title, path, workspace: '/ws', updatedAt: 0 }
}

describe('buildFolderTree', () => {
  it('places root-level notes directly under the root', () => {
    const n = note('Root Note', '/ws/Root Note.md')
    const tree = buildFolderTree('/ws', [], [n])
    expect(tree).toEqual([{ type: 'note', name: 'Root Note', path: '/ws/Root Note.md', note: n }])
  })

  it('nests notes under their folder', () => {
    const n = note('Lecture 1', '/ws/Course101/Lecture 1.md')
    const tree = buildFolderTree('/ws', ['/ws/Course101'], [n])
    expect(tree).toHaveLength(1)
    const folder = tree[0]
    expect(folder?.type).toBe('folder')
    if (folder?.type === 'folder') {
      expect(folder.name).toBe('Course101')
      expect(folder.children).toEqual([{ type: 'note', name: 'Lecture 1', path: n.path, note: n }])
    }
  })

  it('keeps an empty folder with no notes', () => {
    const tree = buildFolderTree('/ws', ['/ws/Empty'], [])
    expect(tree).toEqual([{ type: 'folder', name: 'Empty', path: '/ws/Empty', children: [] }])
  })

  it('sorts folders before notes, each alphabetically', () => {
    const tree = buildFolderTree(
      '/ws',
      ['/ws/Zeta'],
      [note('Beta', '/ws/Beta.md'), note('Alpha', '/ws/Alpha.md')],
    )
    expect(tree.map((e) => e.name)).toEqual(['Zeta', 'Alpha', 'Beta'])
  })

  it('places a canvas under its folder, named without the extension, after the notes', () => {
    const tree = buildFolderTree(
      '/ws',
      ['/ws/\Notes'],
      [note('Alpha', '/ws/\Notes/Alpha.md')],
      ['/ws/\Notes/\map.canvas', '/ws/root.canvas'],
    )
    const notes = tree[0]
    expect(notes?.type === 'folder' && notes.children.map((c) => [c.type, c.name])).toEqual([
      ['note', 'Alpha'],
      ['canvas', 'map'],
    ])
    expect(tree[1]).toEqual({ type: 'canvas', name: 'root', path: '/ws/root.canvas' })
  })

  it('names a canvas on a Windows path without the folder prefix', () => {
    const path = String.raw`D:\ws\Notes\map.canvas`
    const tree = buildFolderTree(String.raw`D:\ws`, [String.raw`D:\ws\Notes`], [], [path])
    const notes = tree[0]
    expect(notes?.type === 'folder' && notes.children).toEqual([{ type: 'canvas', name: 'map', path }])
  })

  it('handles nested subfolders', () => {
    const n = note('Deep', '/ws/A/B/Deep.md')
    const tree = buildFolderTree('/ws', ['/ws/A', '/ws/A/B'], [n])
    const a = tree[0]
    expect(a?.type).toBe('folder')
    if (a?.type === 'folder') {
      const b = a.children[0]
      expect(b?.type).toBe('folder')
      if (b?.type === 'folder') {
        expect(b.children).toEqual([{ type: 'note', name: 'Deep', path: n.path, note: n }])
      }
    }
  })

  it('joins folder paths with the same separator style as a Windows-style root', () => {
    // On Windows, root paths use backslash (e.g. D:\Workspace). A folder's
    // reconstructed path must also use backslash so it round-trips
    // byte-for-byte through backend commands like create_note — otherwise
    // a note created "in" this folder gets a path string that a later
    // filesystem scan won't recognize as the same file (mixed separators
    // defeat the DB's path-based uniqueness check).
    const tree = buildFolderTree('D:\\Workspace', ['D:\\Workspace\\Course101'], [])
    const folder = tree[0]
    expect(folder?.type).toBe('folder')
    if (folder?.type === 'folder') {
      expect(folder.path).toBe('D:\\Workspace\\Course101')
    }
  })
})
