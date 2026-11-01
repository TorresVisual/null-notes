import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { coreExtensions } from './index'

let editor: Editor | null = null

function roundTrip(markdown: string): string {
  const element = document.createElement('div')
  document.body.appendChild(element)
  editor = new Editor({ element, extensions: coreExtensions, content: markdown })
  const storage = editor.storage as unknown as { markdown: { getMarkdown: () => string } }
  return storage.markdown.getMarkdown()
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('code fences (#167)', () => {
  it('keeps a longer fence around a block that contains a ``` fence', () => {
    const src = '````md\n```js\ninner\n```\n````'
    expect(roundTrip(src)).toBe(src)
  })

  it('still uses a plain 3-backtick fence when the code has no backtick run', () => {
    const src = '```js\nconst a = `x`\n```'
    expect(roundTrip(src)).toBe(src)
  })
})

describe('HTML comments (#168)', () => {
  it('keeps a standalone comment', () => {
    expect(roundTrip('before\n\n<!-- keep me -->\n\nafter')).toContain('<!-- keep me -->')
  })

  it('keeps a multi-line comment verbatim', () => {
    const src = 'before\n\n<!--\nline one\nline two\n-->\n\nafter'
    expect(roundTrip(src)).toContain('<!--\nline one\nline two\n-->')
  })

  it('leaves a flashcard schedule comment to SrState, once', () => {
    const out = roundTrip('Q :: A\n\n<!-- sr due=2026-11-02 ease=2.5 interval=1 reps=1 -->')
    expect(out.match(/<!-- sr /g)).toHaveLength(1)
  })
})

describe('table cells (#169)', () => {
  it('re-escapes a pipe in cell text', () => {
    const src = '| a | b \\| c |\n| --- | --- |\n| 1 | 2 |'
    expect(roundTrip(src).trimEnd()).toBe(src)
  })

  it('does not double-escape a pipe that is already escaped, or a literal backslash before one', () => {
    const src = '| a |\n| --- |\n| x \\\\\\| y |'
    expect(roundTrip(src).trimEnd()).toBe(src)
  })

  it('escapes a pipe inside a code span in a cell', () => {
    const src = '| a |\n| --- |\n| `x\\|y` |'
    expect(roundTrip(src).trimEnd()).toBe(src)
  })
})

describe('footnote continuation lines (#170)', () => {
  it('joins an indented continuation line into the definition instead of a code block', () => {
    const out = roundTrip('Text[^1].\n\n[^1]: First\n    continued here.\n\n[^2]: Next.')
    expect(out).toContain('[^1]: First continued here.')
    expect(out).not.toContain('```')
    expect(out).toContain('[^2]: Next.')
  })
})

describe('escaped wiki-link text (#171)', () => {
  it('keeps the escapes on literal [[x]] so it does not become a link on reload', () => {
    const src = 'see \\[\\[x\\]\\] here'
    const once = roundTrip(src)
    expect(once).toBe(src)
    expect(roundTrip(once)).toBe(src)
  })

  it('still writes a lone bracket without a backslash', () => {
    expect(roundTrip('a [b] c')).toBe('a [b] c')
  })
})

describe('blocks after a raw-HTML container', () => {
  const after = 'after **bold** and `code`'

  it.each([
    ['div', '<div align="center">\n\nhi\n\n</div>'],
    ['details', '<details>\n<summary>S</summary>\n\nbody\n\n</details>'],
  ])('keeps the block after a %s parseable across repeated saves', (_name, container) => {
    const once = roundTrip(`${container}\n\n${after}`)
    expect(once).toContain(`\n\n${after}`)
    expect(roundTrip(roundTrip(once))).toBe(once)
  })
})

describe('flashcard schedule comment (#172)', () => {
  it.each([
    'Q :: A\n\n<!-- sr due=2026-11-02 ease=2.5 interval=1 reps=1 grade=again streak=0 lapses=3 -->',
    'Q :: A\n\n<!-- sr due=2026-11-02 ease=2.5 interval=1 reps=1 lapses=2 suspended=true -->',
  ])('keeps lapses across a save: %s', (src) => {
    expect(roundTrip(src).trimEnd()).toBe(src)
  })
})

describe('entity-like literal text (#173)', () => {
  it.each(['&amp;lt; and &amp;amp;', 'a &amp;#35; b'])('keeps %s as literal text across saves', (src) => {
    const once = roundTrip(src)
    expect(once).toBe(src)
    expect(roundTrip(once)).toBe(src)
  })

  it('leaves a bare ampersand alone', () => {
    expect(roundTrip('A & B &c')).toBe('A & B &c')
  })
})
