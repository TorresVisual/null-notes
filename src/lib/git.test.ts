import { describe, expect, it } from 'vitest'
import { withGitLock } from './git'

describe('withGitLock', () => {
  // #86: this is the one property the fix actually depends on — two calls
  // queued close together must run one at a time, never overlap.
  it('runs overlapping calls one at a time, in order', async () => {
    const events: string[] = []
    const first = withGitLock(async () => {
      events.push('first:start')
      await new Promise((resolve) => setTimeout(resolve, 20))
      events.push('first:end')
    })
    const second = withGitLock(async () => {
      events.push('second:start')
      await new Promise((resolve) => setTimeout(resolve, 5))
      events.push('second:end')
    })

    await Promise.all([first, second])

    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end'])
  })

  it('keeps queuing later calls even after an earlier one rejects', async () => {
    const failing = withGitLock(async () => {
      throw new Error('boom')
    })
    await expect(failing).rejects.toThrow('boom')

    const events: string[] = []
    await withGitLock(async () => {
      events.push('ran')
    })

    expect(events).toEqual(['ran'])
  })
})
