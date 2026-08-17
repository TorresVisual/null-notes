import { describe, it, expect } from 'vitest'
import { findCodeLinks, codeBlockSourcePath } from './codeLinks'

function targets(text: string): string[] {
  return findCodeLinks(text).map((l) => l.target)
}

describe('findCodeLinks', () => {
  it('finds a path with a line number', () => {
    const [link] = findCodeLinks('see src/main.cpp:58 for the loop')

    expect(link?.target).toBe('src/main.cpp')
    expect(link?.line).toBe(58)
  })

  it('finds a path with no line number', () => {
    const [link] = findCodeLinks('defined in src/pdf/layout.rs today')

    expect(link?.target).toBe('src/pdf/layout.rs')
    expect(link?.line).toBeNull()
  })

  // A range opens at its first line: the launch template takes one number, and
  // the first is the one the reader means.
  it('opens a #L range at its first line', () => {
    const [link] = findCodeLinks('path/file.rs#L20-L30')

    expect(link?.target).toBe('path/file.rs')
    expect(link?.line).toBe(20)
  })

  it('accepts a single #L reference', () => {
    expect(findCodeLinks('path/file.rs#L7')[0]?.line).toBe(7)
  })

  // A column is ignored rather than rejected — none of the editor templates
  // take one, and dropping it still opens the right line.
  it('ignores a trailing column', () => {
    const [link] = findCodeLinks('src/a.ts:58:12')

    expect(link?.target).toBe('src/a.ts')
    expect(link?.line).toBe(58)
  })

  it('reports where the match sits so it can be decorated', () => {
    const [link] = findCodeLinks('see src/main.cpp:58 here')

    expect(link?.from).toBe(4)
    expect(link?.to).toBe(19)
  })

  it('finds several links in one paragraph', () => {
    expect(targets('src/a.ts:1 and docs/b.md:2')).toEqual(['src/a.ts', 'docs/b.md'])
  })

  // The false positives that make this feature worse than nothing. Each was a
  // real shape from this repo's own notes.
  it('ignores prose that merely contains a colon and a number', () => {
    expect(targets('Analysis 2: 58 exercises')).toEqual([])
    expect(targets('the meeting is at 10:30')).toEqual([])
    expect(targets('see chapter 4:2 for detail')).toEqual([])
  })

  it('ignores a bare filename with no directory', () => {
    expect(targets('open README.md for setup')).toEqual([])
  })

  it('ignores a directory path with no file extension', () => {
    expect(targets('everything under src/editor/extensions lives there')).toEqual([])
  })

  it('does not swallow surrounding words into a match', () => {
    const [link] = findCodeLinks('the file src/a.ts holds it')

    expect(link?.target).toBe('src/a.ts')
    expect(link?.from).toBe(9)
    expect(link?.to).toBe(17)
  })

  it('handles a path with dots and dashes in its segments', () => {
    expect(targets('src-tauri/src/pdf/layout.rs:939')).toEqual(['src-tauri/src/pdf/layout.rs'])
  })

  it('finds nothing in ordinary prose', () => {
    expect(targets('This paragraph names no files at all.')).toEqual([])
  })
})

describe('codeBlockSourcePath', () => {
  it('reads a bare path with no comment marker', () => {
    const link = codeBlockSourcePath('src/main.rs')

    expect(link?.target).toBe('src/main.rs')
    expect(link?.line).toBeNull()
  })

  it('strips a line-comment marker before matching', () => {
    expect(codeBlockSourcePath('// src/main.rs')?.target).toBe('src/main.rs')
    expect(codeBlockSourcePath('# scripts/build.py')?.target).toBe('scripts/build.py')
    expect(codeBlockSourcePath('-- sql/migrate.sql')?.target).toBe('sql/migrate.sql')
  })

  it('carries a line number through the same as prose', () => {
    expect(codeBlockSourcePath('// src/main.rs:58')?.line).toBe(58)
  })

  // A path named mid-sentence is prose, not an annotation — the whole
  // stripped line has to be nothing but the path.
  it('ignores a path mentioned inside a real comment', () => {
    expect(codeBlockSourcePath('// see src/main.rs for details')).toBeNull()
  })

  it('ignores an ordinary line of code', () => {
    expect(codeBlockSourcePath('fn main() {')).toBeNull()
    expect(codeBlockSourcePath('import os')).toBeNull()
  })

  it('ignores a blank first line', () => {
    expect(codeBlockSourcePath('')).toBeNull()
    expect(codeBlockSourcePath('   ')).toBeNull()
  })

  it('ignores a shebang', () => {
    expect(codeBlockSourcePath('#!/usr/bin/env python')).toBeNull()
  })

  it('ignores a line naming two paths', () => {
    expect(codeBlockSourcePath('src/a.ts and src/b.ts')).toBeNull()
  })
})
