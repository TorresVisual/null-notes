import { describe, it, expect } from 'vitest'
import { addFlashcardForLastTask } from './taskToFlashcard'

const NOTE_PATH = '/ws/Lecture 7.md'

function sheet(withInk: boolean): string {
  return [
    '## Task 1',
    '',
    'What is Big-O of binary search?',
    '',
    '### Solution',
    '',
    ...(withInk ? ['```ink', '{"src":"/ws/Lecture 7.ink/solution-1.svg","width":700,"height":400}', '```', ''] : []),
  ].join('\n')
}

describe('addFlashcardForLastTask', () => {
  it('builds a card from the front text and the ink drawing', () => {
    const out = addFlashcardForLastTask(sheet(true), NOTE_PATH)

    expect(out.kind).toBe('inserted')
    if (out.kind !== 'inserted') return
    expect(out.markdown).toContain(
      'What is Big-O of binary search? :: ![Task 1 solution](Lecture%207.ink/solution-1.svg)',
    )
  })

  it('flattens a multi-line problem statement onto one line', () => {
    const md = [
      '## Task 1',
      '',
      'Given a graph G,',
      'show that it has no odd cycles.',
      '',
      '### Solution',
      '',
      '```ink',
      '{"src":"/ws/N.ink/a.svg"}',
      '```',
      '',
    ].join('\n')

    const out = addFlashcardForLastTask(md, '/ws/N.md')

    expect(out.kind).toBe('inserted')
    if (out.kind !== 'inserted') return
    expect(out.markdown).toContain('Given a graph G, show that it has no odd cycles. ::')
  })

  it('targets the last task when there are several', () => {
    const md = [
      '## Task 1',
      '',
      'First question',
      '',
      '### Solution',
      '',
      '```ink',
      '{"src":"/ws/N.ink/a.svg"}',
      '```',
      '',
      '## Task 2',
      '',
      'Second question',
      '',
      '### Solution',
      '',
      '```ink',
      '{"src":"/ws/N.ink/b.svg"}',
      '```',
      '',
    ].join('\n')

    const out = addFlashcardForLastTask(md, '/ws/N.md')

    expect(out.kind).toBe('inserted')
    if (out.kind !== 'inserted') return
    expect(out.markdown).toContain('Second question :: ![Task 2 solution](N.ink/b.svg)')
    expect(out.markdown).not.toContain('First question ::')
  })

  it('reports no-task when the note has no Task heading', () => {
    expect(addFlashcardForLastTask('# Lecture 7\n\nordinary prose', NOTE_PATH)).toEqual({ kind: 'no-task' })
  })

  it('reports no-solution when the last task has no Solution heading', () => {
    const md = ['## Task 1', '', 'A question with no solution section yet', ''].join('\n')

    expect(addFlashcardForLastTask(md, NOTE_PATH)).toEqual({ kind: 'no-solution' })
  })

  it('reports no-drawing when the solution has not been worked yet', () => {
    expect(addFlashcardForLastTask(sheet(false), NOTE_PATH)).toEqual({ kind: 'no-drawing' })
  })

  it('is idempotent: running it twice does not duplicate the card', () => {
    const once = addFlashcardForLastTask(sheet(true), NOTE_PATH)
    expect(once.kind).toBe('inserted')
    if (once.kind !== 'inserted') return

    expect(addFlashcardForLastTask(once.markdown, NOTE_PATH)).toEqual({ kind: 'already-exists' })
  })
})
