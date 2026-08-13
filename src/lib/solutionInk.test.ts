import { describe, it, expect } from 'vitest'
import {
  countSolutions,
  emptySolutionCount,
  inkFence,
  withInkUnderSolutions,
  SOLUTION_INK_HEIGHT,
} from './solutionInk'

const sheet = ['## Task 1', '', '1. Erste Aufgabe', '', '### Solution', '', '## Task 2', '', '2. Zweite', '', '### Solution', ''].join('\n')

describe('countSolutions', () => {
  it('counts every solution heading', () => {
    expect(countSolutions(sheet)).toBe(2)
  })

  it('is zero in a note with none', () => {
    expect(countSolutions('# Lecture 7\n\nprose')).toBe(0)
  })

  it('does not count a mention of the word in prose', () => {
    expect(countSolutions('The solution is left as an exercise.\n\n### Solutions found')).toBe(0)
  })
})

describe('withInkUnderSolutions', () => {
  it('puts a canvas under each solution, in order', () => {
    const out = withInkUnderSolutions(sheet, ['/ws/N.ink/a.svg', '/ws/N.ink/b.svg'])

    expect(out).toContain(inkFence('/ws/N.ink/a.svg'))
    expect(out).toContain(inkFence('/ws/N.ink/b.svg'))
    expect(out.indexOf('a.svg')).toBeLessThan(out.indexOf('## Task 2'))
  })

  it('places the canvas directly under the heading it belongs to', () => {
    const out = withInkUnderSolutions('### Solution\n', ['/ws/N.ink/a.svg']).split('\n')

    expect(out[0]).toBe('### Solution')
    expect(out[1]).toBe('')
    expect(out[2]).toBe('```ink')
  })

  it('starts the canvas short, since it grows as you write into it', () => {
    const out = withInkUnderSolutions('### Solution\n', ['/ws/N.ink/a.svg'])

    expect(out).toContain(`"height":${SOLUTION_INK_HEIGHT}`)
  })

  // Running the command twice must not bury the first run's handwriting under
  // a second blank canvas.
  it('leaves a solution that already holds something alone', () => {
    const done = ['## Task 1', '', '### Solution', '', '```ink', '{"src":"/ws/N.ink/mine.svg"}', '```', ''].join('\n')

    const out = withInkUnderSolutions(done, ['/ws/N.ink/new.svg'])

    expect(out).toBe(done)
    expect(out).not.toContain('new.svg')
  })

  it('fills only the empty solutions in a partly-worked sheet', () => {
    const partly = [
      '## Task 1',
      '',
      '### Solution',
      '',
      'already typed an answer here',
      '',
      '## Task 2',
      '',
      '### Solution',
      '',
    ].join('\n')

    const out = withInkUnderSolutions(partly, ['/ws/N.ink/a.svg'])

    expect(out.match(/```ink/g)).toHaveLength(1)
    expect(out.indexOf('a.svg')).toBeGreaterThan(out.indexOf('## Task 2'))
  })

  it('stops when it runs out of sources rather than inventing one', () => {
    const out = withInkUnderSolutions(sheet, ['/ws/N.ink/a.svg'])

    expect(out.match(/```ink/g)).toHaveLength(1)
  })

  it('changes nothing when there are no solutions', () => {
    const plain = '# Lecture 7\n\nordinary prose\n'

    expect(withInkUnderSolutions(plain, ['/ws/N.ink/a.svg'])).toBe(plain)
  })
})

describe('emptySolutionCount', () => {
  it('is how many canvases would actually be placed', () => {
    expect(emptySolutionCount(sheet)).toBe(2)
  })

  it('excludes solutions that already hold work', () => {
    const done = ['### Solution', '', 'my answer', '', '## Task 2', '', '### Solution', ''].join('\n')

    expect(emptySolutionCount(done)).toBe(1)
  })
})
