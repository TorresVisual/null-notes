import { describe, it, expect } from 'vitest'
import { quickNoteTitle, isUntouchedQuickNote } from './quickNote'

describe('quickNoteTitle', () => {
  it('uses local time, zero-padded, with hyphens only', () => {
    expect(quickNoteTitle(new Date(2026, 10, 10, 9, 5))).toBe('Quick note 2026-11-10 09-05')
  })
})

describe('isUntouchedQuickNote', () => {
  it('is true for the bare heading, with or without trailing newline', () => {
    expect(isUntouchedQuickNote('T', '# T\n')).toBe(true)
    expect(isUntouchedQuickNote('T', '# T')).toBe(true)
  })

  it('is true for empty content', () => {
    expect(isUntouchedQuickNote('T', '')).toBe(true)
  })

  it('is false once anything follows the heading', () => {
    expect(isUntouchedQuickNote('T', '# T\n\nhello')).toBe(false)
  })
})
