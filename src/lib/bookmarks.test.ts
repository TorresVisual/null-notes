import { describe, expect, it } from 'vitest'
import {
  moveBookmark,
  parseBookmarks,
  rewriteBookmarkPrefix,
  sectionBookmarks,
  serializeBookmarks,
  type Bookmark,
} from './bookmarks'

const WS = 'C:\\ws'
const sample: Bookmark[] = [
  { kind: 'note', path: 'C:\\ws\\Algo\\Sheet 3.md', group: 'This week' },
  { kind: 'folder', path: 'C:\\ws\\Algo' },
  { kind: 'heading', path: 'C:\\ws\\Algo\\Sheet 3.md', heading: 'Task 2' },
  { kind: 'search', query: 'folder:Algo tag:exam', group: 'This week' },
]

describe('bookmarks file', () => {
  it('writes one relative-path JSON line per bookmark and reads it back', () => {
    const text = serializeBookmarks(sample, WS)
    expect(text.trimEnd().split('\n')).toHaveLength(4)
    expect(text).toContain('"path":"Algo/Sheet 3.md"')
    expect(parseBookmarks(text, WS)).toEqual(sample)
  })

  it('skips conflict markers and garbage but keeps intact lines', () => {
    const text = '<<<<<<< HEAD\n{"kind":"folder","path":"Algo"}\n=======\n{"kind":"bogus"}\n>>>>>>> x\n'
    expect(parseBookmarks(text, '/ws')).toEqual([{ kind: 'folder', path: '/ws/Algo', group: undefined }])
  })
})

describe('bookmark edits', () => {
  it('follows a folder rename and leaves searches alone', () => {
    const next = rewriteBookmarkPrefix(sample, 'C:\\ws\\Algo', 'C:\\ws\\Algorithms')
    expect(next[0]).toMatchObject({ path: 'C:\\ws\\Algorithms\\Sheet 3.md' })
    expect(next[3]).toBe(sample[3])
    expect(rewriteBookmarkPrefix(sample, 'C:\\ws\\Other', 'C:\\ws\\X')).toBe(sample)
  })

  it('sections ungrouped first, then groups by first appearance', () => {
    const sections = sectionBookmarks(sample)
    expect(sections.map((s) => s.group)).toEqual([null, 'This week'])
    expect(sections[1]?.entries.map((e) => e.index)).toEqual([0, 3])
  })

  it('moves a bookmark before another, adopting its group', () => {
    const moved = moveBookmark(sample, 3, 1, undefined)
    expect(moved.map((b) => b.kind)).toEqual(['note', 'search', 'folder', 'heading'])
    expect(moved[1]?.group).toBeUndefined()
    expect(moveBookmark(sample, 0, 4, 'Z').at(-1)).toMatchObject({ kind: 'note', group: 'Z' })
  })
})
