import { describe, it, expect } from 'vitest'
import { kanbanMove, toPropertyValue } from './kanbanMove'

describe('kanbanMove', () => {
  it('sets a scalar property to the target column', () => {
    expect(kanbanMove('todo', 'todo', 'done')).toBe('done')
    expect(kanbanMove(undefined, null, 'done')).toBe('done')
  })

  it('replaces only the dragged value in a list property', () => {
    expect(kanbanMove(['a', 'b'], 'a', 'c')).toEqual(['c', 'b'])
    expect(kanbanMove(['a', 'c'], 'a', 'c')).toEqual(['c'])
  })

  it('adds the target value when the card came from "No value"', () => {
    expect(kanbanMove([], null, 'x')).toEqual(['x'])
  })

  it('removes the value when dropped on "No value"', () => {
    expect(kanbanMove('todo', 'todo', null)).toBeUndefined()
    expect(kanbanMove(['a', 'b'], 'a', null)).toEqual(['b'])
    expect(kanbanMove(['a'], 'a', null)).toBeUndefined()
  })
})

describe('toPropertyValue', () => {
  it('keeps plain values and writes dates and links back as text', () => {
    expect(toPropertyValue('x')).toBe('x')
    expect(toPropertyValue(3)).toBe(3)
    expect(toPropertyValue({ __type: 'date', ms: new Date(2026, 10, 5).getTime(), hasTime: false })).toBe('2026-11-05')
    expect(toPropertyValue({ __type: 'link', path: 'B' })).toBe('[[B]]')
    expect(toPropertyValue(null)).toBeUndefined()
  })
})
