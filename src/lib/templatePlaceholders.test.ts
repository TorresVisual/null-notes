import { describe, it, expect } from 'vitest'
import { extractPlaceholders, fillTemplate } from './templatePlaceholders'

describe('extractPlaceholders', () => {
  it('returns unique names in first-appearance order', () => {
    expect(extractPlaceholders('# {{course}} — {{sheet}}\n\n{{course}} again')).toEqual([
      'course',
      'sheet',
    ])
  })

  it('returns an empty list when the template has no placeholders', () => {
    expect(extractPlaceholders('# Plain note\n\nno blanks here')).toEqual([])
  })

  it('ignores braces that are not a well-formed placeholder', () => {
    expect(extractPlaceholders('a { b } and {{ course }} and {{}}')).toEqual([])
  })
})

describe('fillTemplate', () => {
  it('replaces every occurrence of a placeholder', () => {
    expect(fillTemplate('{{course}}: {{course}} notes', { course: 'Analysis II' })).toBe(
      'Analysis II: Analysis II notes',
    )
  })

  it('leaves an unmatched placeholder untouched', () => {
    expect(fillTemplate('{{course}} — {{sheet}}', { course: 'Analysis II' })).toBe(
      'Analysis II — {{sheet}}',
    )
  })

  it('does literal substitution only, with no logic on the replacement value', () => {
    expect(fillTemplate('{{note}}', { note: '{{course}}' })).toBe('{{course}}')
  })
})
