import { describe, expect, it } from 'vitest'
import { analyseOutgoingLinks } from './outgoingLinks'
import type { NoteMetadata } from '../types'

const WS = 'C:/ws'
const note = (path: string, title: string): NoteMetadata => ({
  id: path,
  title,
  path: `${WS}/${path}`,
  workspace: WS,
  updatedAt: 0,
})

const SELF = note('Self.md', 'Self')
const NOTES = [
  SELF,
  note('Graphs.md', 'Graphs'),
  note('A/Sheet 01.md', 'Sheet 01'),
  note('B/Sheet 01.md', 'Sheet 01'),
  note('sub/Trees.md', 'Trees'),
  note('DB.md', 'DB'),
]

const run = (content: string) => analyseOutgoingLinks(content, SELF.path, WS, NOTES)

describe('analyseOutgoingLinks', () => {
  it('counts wiki and Markdown references to the same note as one link', () => {
    const { links } = run('[[Trees]] and [[trees#Intro|t]] and [x](sub/Trees.md)')
    expect(links).toHaveLength(1)
    expect(links[0]?.count).toBe(3)
  })

  it('lists every note sharing a title in one ambiguous row', () => {
    const { links } = run('[[Sheet 01]]')
    expect(links).toHaveLength(1)
    expect(links[0]?.candidates.map((c) => c.path)).toEqual([`${WS}/A/Sheet 01.md`, `${WS}/B/Sheet 01.md`])
  })

  it('reports missing wiki and Markdown targets as unresolved', () => {
    const { unresolved } = run('[[Nope]] [[nope]] [x](Missing%20Note.md) [pdf](a.pdf) [web](https://x.dev/a.md)')
    expect(unresolved.map((u) => [u.title, u.count, u.folder])).toEqual([
      ['Nope', 2, undefined],
      ['Missing Note', 1, 'C:/ws'],
    ])
  })

  it('refuses to offer creation for a Markdown target that escapes the folder', () => {
    const { unresolved } = run('[x](../../evil.md) [y](deep/er/New.md)')
    expect(unresolved.map((u) => [u.blocked, u.folder])).toEqual([
      [true, expect.any(String)],
      [false, 'C:/ws/deep/er'],
    ])
  })

  it('finds whole-word title mentions outside links, code and its own title', () => {
    const { possible } = run(
      '---\ntags: Trees\n---\nSelf talks about graphs, GRAPHS and Trees.\n`Trees` [[Graphs]]\n```\nTrees\n```\nSubtrees DB',
    )
    expect(possible.map((p) => [p.title, p.count])).toEqual([['Trees', 1]])
  })

  it('does not suggest a note that is already linked', () => {
    expect(run('[[Graphs]] graphs').possible).toEqual([])
    expect(run('[g](Graphs.md) graphs').possible).toEqual([])
  })
})
