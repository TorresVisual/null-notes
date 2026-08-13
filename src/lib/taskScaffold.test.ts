import { describe, it, expect } from 'vitest'
import { nextTaskLabel } from './taskScaffold'

describe('nextTaskLabel', () => {
  it('starts at 1 in a note with no tasks', () => {
    expect(nextTaskLabel('# Lecture notes\n\nSome prose.')).toBe('1')
  })

  it('continues a plain run', () => {
    const note = '## Task 1\n\n### Solution\n\nworked it\n\n## Task 2\n\n### Solution\n'

    expect(nextTaskLabel(note)).toBe('3')
  })

  // Ue9's sheet numbers its exercises 9.1…9.5, so the next one is 9.6. Only
  // the last component moves: the leading 9 names the sheet, not the exercise.
  it('advances only the last component of a dotted label', () => {
    expect(nextTaskLabel('## Task 9.5\n\n### Solution\n')).toBe('9.6')
  })

  // Positional, not numerically highest: what "the next one" means to a reader
  // is whatever follows the task at the bottom of the note.
  it('counts from the last heading, not the largest number', () => {
    const note = '## Task 7\n\n### Solution\n\n## Task 2\n\n### Solution\n'

    expect(nextTaskLabel(note)).toBe('3')
  })

  // The importer writes `## Task N`; a `### Solution` or a task written into
  // prose is not a heading of that shape and must not be counted.
  it('ignores anything that is not a task heading', () => {
    const note = '## Tasks for today\n\nTask 4 was hard.\n\n### Task 8\n'

    expect(nextTaskLabel(note)).toBe('1')
  })
})
