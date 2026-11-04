import { describe, it, expect } from 'vitest'
import { findCrossRefs } from './crossRefs'

describe('findCrossRefs', () => {
  it('recognises a keyword plus a plain number', () => {
    expect(findCrossRefs('See Theorem 3 for details')).toEqual([
      { calloutType: 'theorem', number: '3', from: 4, to: 13 },
    ])
  })

  it('recognises a dotted number', () => {
    expect(findCrossRefs('See Theorem 3.2 for details')).toEqual([
      { calloutType: 'theorem', number: '3.2', from: 4, to: 15 },
    ])
  })

  it('is case-insensitive on the keyword but normalizes it to lowercase', () => {
    expect(findCrossRefs('by lemma 5')).toEqual([{ calloutType: 'lemma', number: '5', from: 3, to: 10 }])
  })

  it('matches every supported keyword', () => {
    const text = 'Theorem 1, Lemma 2, Corollary 3, Proof 4, Definition 5, Example 6, Algorithm 7, Task 8'
    const found = findCrossRefs(text).map((r) => r.calloutType)
    expect(found).toEqual(['theorem', 'lemma', 'corollary', 'proof', 'definition', 'example', 'algorithm', 'task'])
  })

  it('finds several references in one line', () => {
    expect(findCrossRefs('Theorem 1 follows from Lemma 2').map((r) => r.calloutType)).toEqual([
      'theorem',
      'lemma',
    ])
  })

  it('does not match a keyword with no number', () => {
    expect(findCrossRefs('This theorem is elegant')).toEqual([])
  })

  it('does not match an unrelated word that merely contains a keyword', () => {
    expect(findCrossRefs('Metatheorem 3')).toEqual([])
  })

  it('does not match a plain wiki-link to a theorem note', () => {
    expect(findCrossRefs('[[Theorem: Squeeze Theorem]]')).toEqual([])
  })
  it('recognises a Task mention with a dotted number', () => {
    expect(findCrossRefs('as in Task 9.2')).toEqual([
      { calloutType: 'task', number: '9.2', from: 6, to: 14 },
    ])
  })

  it('recognises a Task mention with a plain number', () => {
    expect(findCrossRefs('see Task 3 for the setup')).toEqual([
      { calloutType: 'task', number: '3', from: 4, to: 10 },
    ])
  })

  it.each(['Aufgabe', 'Beispiel', 'Exercise', 'Problem'])('maps %s onto the task kind', (word) => {
    expect(findCrossRefs(`siehe ${word} 3`)).toEqual([
      { calloutType: 'task', number: '3', from: 6, to: 6 + word.length + 2 },
    ])
  })

  it('recognises a Figure mention', () => {
    expect(findCrossRefs('as shown in Figure 2.1')).toEqual([
      { calloutType: 'figure', number: '2.1', from: 12, to: 22 },
    ])
  })
})
