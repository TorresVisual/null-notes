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
    rememberPosition('Merge.md', { scrollFraction: 0.42 })
    rememberPosition('Merge.md', { cursorFraction: 0.17 })

    expect(recallPosition('Merge.md')).toEqual({ cursorFraction: 0.17, scrollFraction: 0.42 })
  })

  it('defaults the half that was never written', () => {
    rememberPosition('Half.md', { scrollFraction: 0.42 })
    expect(recallPosition('Half.md')).toEqual({ cursorFraction: 0, scrollFraction: 0.42 })
  })

  it('keeps notes independent', () => {
    rememberPosition('A.md', { scrollFraction: 0.1 })
    rememberPosition('B.md', { scrollFraction: 0.99 })

    expect(recallPosition('A.md')?.scrollFraction).toBe(0.1)
    expect(recallPosition('B.md')?.scrollFraction).toBe(0.99)
  })

  it('forgets a note so a stale offset cannot outlive its path', () => {
    rememberPosition('Gone.md', { scrollFraction: 0.1 })
    forgetPosition('Gone.md')

    expect(recallPosition('Gone.md')).toBeUndefined()
  })
})
