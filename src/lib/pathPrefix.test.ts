import { describe, it, expect } from 'vitest'
import { folderName, isSingleSegmentName, isUnderPath, noteFolderSegments, replacePathPrefix } from './pathPrefix'

describe('noteFolderSegments', () => {
  it('returns the folders between workspace root and note, under either separator', () => {
    expect(noteFolderSegments('/ws/DSA/Week 1/a.md', '/ws')).toEqual(['DSA', 'Week 1'])
    expect(noteFolderSegments('C:\\ws\\DSA\\a.md', 'C:\\ws')).toEqual(['DSA'])
  })

  it('is empty for a root note, a foreign path, or no workspace', () => {
    expect(noteFolderSegments('/ws/a.md', '/ws')).toEqual([])
    expect(noteFolderSegments('/other/x/a.md', '/ws')).toEqual([])
    expect(noteFolderSegments('/ws/x/a.md', null)).toEqual([])
  })
})

describe('isSingleSegmentName', () => {
  it('accepts a plain name, including spaces and non-Latin text', () => {
    expect(isSingleSegmentName('Lecture 7')).toBe(true)
    expect(isSingleSegmentName('線形代数')).toBe(true)
  })

  it('rejects separators and dot segments that would leave the parent', () => {
    for (const name of ['a/b', 'a\\b', '..', '.', '../x']) {
      expect(isSingleSegmentName(name)).toBe(false)
    }
  })
})

describe('folderName', () => {
  it('takes the last segment of a Windows path', () => {
    expect(folderName('D:\\Uni\\CS101')).toBe('CS101')
  })

  it('takes the last segment of a posix path', () => {
    expect(folderName('/home/me/notes')).toBe('notes')
  })

  it('ignores a trailing separator', () => {
    expect(folderName('D:\\Uni\\CS101\\')).toBe('CS101')
  })

  it('falls back to the whole path for a drive root', () => {
    expect(folderName('/')).toBe('/')
  })
})

describe('isUnderPath', () => {
  it('matches an exact path', () => {
    expect(isUnderPath('/ws/a.md', '/ws/a.md')).toBe(true)
  })

  it('matches a path nested under the prefix', () => {
    expect(isUnderPath('/ws/Course1/a.md', '/ws/Course1')).toBe(true)
  })

  it('does not match a sibling with a similar name', () => {
    expect(isUnderPath('/ws/Course10/a.md', '/ws/Course1')).toBe(false)
  })

  it('does not match an unrelated path', () => {
    expect(isUnderPath('/ws/Other/a.md', '/ws/Course1')).toBe(false)
  })
})

describe('replacePathPrefix', () => {
  it('replaces an exact match entirely', () => {
    expect(replacePathPrefix('/ws/a.md', '/ws/a.md', '/ws/Folder/a.md')).toBe('/ws/Folder/a.md')
  })

  it('replaces a nested path prefix', () => {
    expect(replacePathPrefix('/ws/Course1/a.md', '/ws/Course1', '/ws/Renamed')).toBe('/ws/Renamed/a.md')
  })

  it('leaves an unrelated path unchanged', () => {
    expect(replacePathPrefix('/ws/Course10/a.md', '/ws/Course1', '/ws/Renamed')).toBe('/ws/Course10/a.md')
  })
})
