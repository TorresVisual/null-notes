import { describe, it, expect } from 'vitest'
import { folderScopeArg, topLevelFolders } from './formulaScope'
import type { NoteMetadata } from '../types'

const note = (path: string): NoteMetadata => ({ id: path, title: path, path, workspace: 'w', updatedAt: 0 })

describe('topLevelFolders', () => {
  const root = '/ws'
  const folders = ['/ws/Algorithms', '/ws/Algorithms/Sorting', '/ws/Discrete Mathematics', '/ws/.null', '/ws/Algorithms 2']
  const notes = [note('/ws/Algorithms/a.md'), note('/ws/Algorithms/Sorting/b.md'), note('/ws/Algorithms 2/c.md'), note('/ws/root.md')]

  it('keeps only first-level, non-hidden folders, sorted naturally', () => {
    expect(topLevelFolders(root, folders, notes).map((f) => f.name)).toEqual(['Algorithms', 'Algorithms 2', 'Discrete Mathematics'])
  })

  it('counts nested notes but not a sibling sharing the name prefix', () => {
    expect(topLevelFolders(root, folders, notes).map((f) => f.noteCount)).toEqual([2, 1, 0])
  })

  it('uses the workspace separator', () => {
    expect(topLevelFolders('C:\\ws', ['C:\\ws\\Algo'], [])[0]?.path).toBe('C:\\ws\\Algo')
    expect(folderScopeArg('C:\\ws\\Algo')).toBe('C:\\ws\\Algo\\')
    expect(folderScopeArg('/ws/Algo')).toBe('/ws/Algo/')
  })
})
