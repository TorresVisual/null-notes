import { describe, it, expect } from 'vitest'
import { isUnderPath, replacePathPrefix } from './pathPrefix'

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
