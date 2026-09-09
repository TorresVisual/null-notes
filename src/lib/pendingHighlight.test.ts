import { describe, it, expect } from 'vitest'
import { setPendingHighlight, takePendingHighlight } from './pendingHighlight'

describe('pendingHighlight', () => {
  it('hands back the text for the path it was set for, once', () => {
    setPendingHighlight('/ws/Target.md', 'zzneedle')

    expect(takePendingHighlight('/ws/Target.md')).toBe('zzneedle')
    expect(takePendingHighlight('/ws/Target.md')).toBeUndefined()
  })

  it('does not hand it back for a different path', () => {
    setPendingHighlight('/ws/Target.md', 'zzneedle')

    expect(takePendingHighlight('/ws/Other.md')).toBeUndefined()
  })
})
