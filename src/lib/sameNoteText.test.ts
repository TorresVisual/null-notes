import { describe, it, expect } from 'vitest'
import { sameNoteText } from './sameNoteText'

describe('sameNoteText', () => {
  it('ignores trailing whitespace, which the editor serializer does not keep', () => {
    expect(sameNoteText('# T\n', '# T')).toBe(true)
    expect(sameNoteText('# T\n\n\n', '# T\n')).toBe(true)
  })

  it('does not ignore leading or interior differences', () => {
    expect(sameNoteText('# T\n\nhello', '# T\n\nhelp')).toBe(false)
    expect(sameNoteText(' # T', '# T')).toBe(false)
  })
})
