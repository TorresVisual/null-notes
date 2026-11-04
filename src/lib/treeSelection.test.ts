import { describe, it, expect } from 'vitest'
import { rangeSelection, toggleSelection, topLevelPaths, visibleTreePaths } from './treeSelection'
import type { TreeEntry } from './folderTree'

const note = (path: string): TreeEntry => ({
  type: 'note',
  name: path,
  path,
  note: { id: path, title: path, path, workspace: '/ws', updatedAt: 0 },
})

describe('treeSelection', () => {
  it('lists only rows on screen, skipping collapsed folders and canvases', () => {
    const tree: TreeEntry[] = [
      { type: 'folder', name: 'A', path: '/ws/A', children: [note('/ws/A/a.md')] },
      { type: 'folder', name: 'B', path: '/ws/B', children: [note('/ws/B/b.md')] },
      note('/ws/c.md'),
      { type: 'canvas', name: 'x', path: '/ws/x.canvas' },
    ]
    expect(visibleTreePaths(tree, ['/ws/A'])).toEqual(['/ws/A', '/ws/A/a.md', '/ws/B', '/ws/c.md'])
  })

  it('toggles a path in and out', () => {
    expect(toggleSelection(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleSelection(['a', 'b'], 'a')).toEqual(['b'])
  })

  it('selects the range between anchor and target in either direction', () => {
    const visible = ['a', 'b', 'c', 'd']
    expect(rangeSelection(visible, 'b', 'd')).toEqual(['b', 'c', 'd'])
    expect(rangeSelection(visible, 'c', 'a')).toEqual(['a', 'b', 'c'])
  })

  it('falls back to the single target without a usable anchor', () => {
    expect(rangeSelection(['a', 'b'], null, 'b')).toEqual(['b'])
    expect(rangeSelection(['a', 'b'], 'gone', 'b')).toEqual(['b'])
  })

  it('drops paths nested inside another selected folder', () => {
    expect(topLevelPaths(['/ws/A', '/ws/A/a.md', '/ws/Ab.md'])).toEqual(['/ws/A', '/ws/Ab.md'])
  })
})
