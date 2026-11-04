import { describe, it, expect } from 'vitest'
import { addFlashcardForLastCallout } from './calloutToFlashcard'

const DEFINITION = ['# Notes', '', '> [!DEFINITION 2.3]', '> A group is a set with an operation.', '> It has an identity.', '', 'after'].join('\n')

describe('addFlashcardForLastCallout', () => {
  it('inserts a card line directly below the callout', () => {
    const out = addFlashcardForLastCallout(DEFINITION)
    expect(out).toEqual({
      kind: 'inserted',
      markdown: [
        '# Notes', '', '> [!DEFINITION 2.3]', '> A group is a set with an operation.', '> It has an identity.', '',
        'Definition 2.3 :: A group is a set with an operation. It has an identity.', '', 'after',
      ].join('\n'),
    })
  })

  it('uses body text on the marker line and picks the last callout', () => {
    const md = `${DEFINITION}\n\n> [!theorem 3.2] Lagrange\n> Order divides.`
    const out = addFlashcardForLastCallout(md)
    expect(out.kind === 'inserted' && out.markdown.endsWith('Theorem 3.2 :: Lagrange Order divides.')).toBe(true)
  })

  it('ignores unnumbered callouts', () => {
    expect(addFlashcardForLastCallout('> [!NOTE]\n> hi')).toEqual({ kind: 'no-callout' })
  })

  it('is idempotent', () => {
    const once = addFlashcardForLastCallout(DEFINITION)
    if (once.kind !== 'inserted') throw new Error('expected insert')
    expect(addFlashcardForLastCallout(once.markdown)).toEqual({ kind: 'already-exists' })
  })

  it('refuses an empty body', () => {
    expect(addFlashcardForLastCallout('> [!LEMMA 1]\n>')).toEqual({ kind: 'empty' })
  })
})
