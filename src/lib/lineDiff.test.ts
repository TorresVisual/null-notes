import { describe, it, expect } from 'vitest'
import { diffLines } from './lineDiff'

describe('diffLines', () => {
  it('marks unchanged lines as same', () => {
    expect(diffLines('a\nb\nc', 'a\nb\nc')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'same', text: 'b' },
      { type: 'same', text: 'c' },
    ])
  })

  it('finds an interior add and remove around unchanged context', () => {
    expect(diffLines('a\nold\nc', 'a\nnew\nc')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'remove', text: 'old' },
      { type: 'add', text: 'new' },
      { type: 'same', text: 'c' },
    ])
  })

  it('marks every line as added when the old text is empty', () => {
    expect(diffLines('', 'a\nb')).toEqual([
      { type: 'remove', text: '' },
      { type: 'add', text: 'a' },
      { type: 'add', text: 'b' },
    ])
  })
})
