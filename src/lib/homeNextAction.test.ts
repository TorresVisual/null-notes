import { describe, it, expect } from 'vitest'
import { homeNextAction } from './homeNextAction'

const last = { path: '/ws/a.md' }

describe('homeNextAction', () => {
  it('leads with review when cards are due, even if a note was edited last', () => {
    expect(homeNextAction({ dueCount: 4, hasCards: true, lastEdited: last })).toEqual({ kind: 'review', dueCount: 4 })
  })

  it('resumes the last-edited note, caught up, when there are cards but none due', () => {
    expect(homeNextAction({ dueCount: 0, hasCards: true, lastEdited: last })).toEqual({
      kind: 'resume',
      path: '/ws/a.md',
      caughtUp: true,
    })
  })

  it('resumes the last-edited note without the caught-up line when the workspace has no cards', () => {
    expect(homeNextAction({ dueCount: 0, hasCards: false, lastEdited: last })).toEqual({
      kind: 'resume',
      path: '/ws/a.md',
      caughtUp: false,
    })
  })

  it('has no action in a workspace with no notes and no cards', () => {
    expect(homeNextAction({ dueCount: 0, hasCards: false, lastEdited: null })).toBeNull()
  })
})
