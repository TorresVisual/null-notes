import { describe, it, expect } from 'vitest'
import { buildHomeSummary } from './homeSummary'

describe('buildHomeSummary', () => {
  it('reports nothing outstanding when not a Git repo and nothing else pending', () => {
    expect(buildHomeSummary({ taskCount: 0, dueCount: 0, gitStatus: null })).toBe(
      'Nothing outstanding right now.',
    )
  })

  it('reports everything up to date when it is a clean Git repo', () => {
    expect(buildHomeSummary({ taskCount: 0, dueCount: 0, gitStatus: 'Up to date' })).toBe(
      "Nothing outstanding — everything's up to date.",
    )
  })

  it('reports a single open task in the singular', () => {
    expect(buildHomeSummary({ taskCount: 1, dueCount: 0, gitStatus: null })).toBe('1 task open.')
  })

  it('reports multiple open tasks in the plural', () => {
    expect(buildHomeSummary({ taskCount: 3, dueCount: 0, gitStatus: null })).toBe('3 tasks open.')
  })

  it('reports a single due card in the singular, alongside tasks', () => {
    expect(buildHomeSummary({ taskCount: 2, dueCount: 1, gitStatus: null })).toBe(
      '2 tasks open, 1 card due.',
    )
  })

  it('includes a non-clean Git status as its own clause', () => {
    expect(buildHomeSummary({ taskCount: 0, dueCount: 0, gitStatus: '3 unpushed' })).toBe('3 unpushed.')
  })

  it('omits a clean Git status even when other counts are non-zero', () => {
    expect(buildHomeSummary({ taskCount: 1, dueCount: 0, gitStatus: 'Up to date' })).toBe('1 task open.')
  })

  it('joins all three clauses when everything has something to report', () => {
    expect(buildHomeSummary({ taskCount: 2, dueCount: 1, gitStatus: '1 ahead, 3 behind' })).toBe(
      '2 tasks open, 1 card due, 1 ahead, 3 behind.',
    )
  })
})
