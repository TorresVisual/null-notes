import { describe, it, expect } from 'vitest'
import { rememberPosition, recallPosition, forgetPosition } from './notePositions'

// Each test uses its own paths — the map is module state, and a shared key
// would make the results depend on execution order.
describe('notePositions', () => {
  it('recalls nothing for a note that was never visited', () => {
    expect(recallPosition('Never.md')).toBeUndefined()
  })

  // The cursor and the scroll offset are written by two different components
  // at two different times, so a patch must not wipe the other half.
  it('merges partial updates rather than replacing the entry', () => {
    rememberPosition('Merge.md', { scrollTop: 420 })
    rememberPosition('Merge.md', { selection: 17 })

    expect(recallPosition('Merge.md')).toEqual({ selection: 17, scrollTop: 420 })
  })

  it('defaults the half that was never written', () => {
    rememberPosition('Half.md', { scrollTop: 420 })
    expect(recallPosition('Half.md')).toEqual({ selection: 0, scrollTop: 420 })
  })

  it('keeps notes independent', () => {
    rememberPosition('A.md', { scrollTop: 10 })
    rememberPosition('B.md', { scrollTop: 99 })

    expect(recallPosition('A.md')?.scrollTop).toBe(10)
    expect(recallPosition('B.md')?.scrollTop).toBe(99)
  })

  it('forgets a note so a stale offset cannot outlive its path', () => {
    rememberPosition('Gone.md', { scrollTop: 10 })
    forgetPosition('Gone.md')

    expect(recallPosition('Gone.md')).toBeUndefined()
  })
})
