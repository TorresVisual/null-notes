import { describe, it, expect } from 'vitest'
import { setPendingHighlight, takePendingHighlight } from './pendingHighlight'

describe('pendingHighlight', () => {
  it('hands back the text for the path it was set for, once', () => {
    setPendingHighlight('/ws/Target.md', 'zzneedle')

    expect(takePendingHighlight('/ws/Target.md')).toEqual({ text: 'zzneedle', heading: false })
    expect(takePendingHighlight('/ws/Target.md')).toBeUndefined()
  })

  it('carries the heading flag through', () => {
    setPendingHighlight('/ws/Target.md', 'Master theorem', true)

    expect(takePendingHighlight('/ws/Target.md')).toEqual({ text: 'Master theorem', heading: true })
  })

  it('does not hand it back for a different path', () => {
    setPendingHighlight('/ws/Target.md', 'zzneedle')

    expect(takePendingHighlight('/ws/Other.md')).toBeUndefined()
  })
})
