import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { coreExtensions } from './index'

let editor: Editor | null = null

function mount(content: string): Editor {
  editor = new Editor({ element: document.createElement('div'), extensions: coreExtensions, content })
  return editor
}

function topLevelTypes(e: Editor): string[] {
  const doc = e.state.doc.toJSON() as { content?: Array<Record<string, unknown>> }
  return (doc.content ?? []).map((node) => node['type'] as string)
}

function mathLatex(e: Editor): string[] {
  const found: string[] = []
  e.state.doc.descendants((node) => {
    if (node.type.name === 'blockMath') found.push(node.attrs['latex'] as string)
    return true
  })
  return found
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

// The serializer emits a lone `$` on its own line, so that dialect is the one
// this app writes. It is not the one the rest of the world writes: Obsidian,
// Notion, GitHub and every LaTeX habit reach for `$$`. A note typed by hand,
// or edited outside the app, arrives in the common dialect and has to parse.
describe('block maths delimiters', () => {
  it('parses the lone-$ fence this app serializes', () => {
    const e = mount('prose\n\n$\nx^2\n$\n\nmore')

    expect(topLevelTypes(e)).toEqual(['paragraph', 'blockMath', 'paragraph'])
    expect(mathLatex(e)).toEqual(['x^2'])
  })

  it('parses a $$ fence', () => {
    const e = mount('prose\n\n$$\nx^2\n$$\n\nmore')

    expect(topLevelTypes(e)).toEqual(['paragraph', 'blockMath', 'paragraph'])
    expect(mathLatex(e)).toEqual(['x^2'])
  })

  it('parses a $$…$$ equation written on one line', () => {
    const e = mount('prose\n\n$$e^{i\\pi} + 1 = 0$$\n\nmore')

    expect(topLevelTypes(e)).toEqual(['paragraph', 'blockMath', 'paragraph'])
    expect(mathLatex(e)).toEqual(['e^{i\\pi} + 1 = 0'])
  })

  // A fence closes with the marker it opened with. Mixing them is a typo, and
  // guessing which half was meant would silently eat the rest of the note.
  it('does not close a $$ fence on a lone $', () => {
    const e = mount('$$\nx^2\n$\n\nprose')

    expect(mathLatex(e)).toEqual([])
  })

  // Every other block construct — a heading, a fence, a list — ends the
  // paragraph above it without needing a blank line. Maths did not, so an
  // equation written directly under its sentence was swallowed whole and the
  // note showed `prose $ x^2 $ more` as one run of text.
  it('ends the paragraph above it without a blank line', () => {
    const e = mount('prose\n$\nx^2\n$\nmore')

    expect(topLevelTypes(e)).toEqual(['paragraph', 'blockMath', 'paragraph'])
    expect(mathLatex(e)).toEqual(['x^2'])
  })

  it('ends the paragraph above a $$ fence too', () => {
    const e = mount('prose\n$$\nx^2\n$$\nmore')

    expect(topLevelTypes(e)).toEqual(['paragraph', 'blockMath', 'paragraph'])
    expect(mathLatex(e)).toEqual(['x^2'])
  })

  // The paragraph-terminating check runs in markdown-it's silent mode, where
  // returning true commits to a break. An unclosed fence is not a block, so
  // saying it is would cut a paragraph in half and render neither piece as
  // maths — worse than leaving the stray `$` as the text it is.
  it('leaves an unclosed fence as ordinary paragraph text', () => {
    const e = mount('prose\n$\nx^2 with no closing fence')

    expect(topLevelTypes(e)).toEqual(['paragraph'])
    expect(mathLatex(e)).toEqual([])
  })

  // A price is not an equation. Inline maths still owns the single-line form.
  it('leaves a lone $ inside a sentence to the inline rule', () => {
    const e = mount('it costs $5 and $x^2$ is maths')

    expect(topLevelTypes(e)).toEqual(['paragraph'])
    expect(mathLatex(e)).toEqual([])
  })

  // Parse liberally, emit conservatively: whichever dialect came in, the file
  // this app writes back stays in the one dialect it has always written.
  it('serializes both dialects back as the lone-$ fence', () => {
    const e = mount('$$\nx^2\n$$')
    const storage = e.storage as unknown as { markdown: { getMarkdown: () => string } }

    expect(storage.markdown.getMarkdown()).toBe('$\nx^2\n$')
  })
})

function mathNumbers(e: Editor): Array<string | null> {
  const found: Array<string | null> = []
  e.state.doc.descendants((node) => {
    if (node.type.name === 'blockMath') found.push(node.attrs['number'] as string | null)
    return true
  })
  return found
}

function markdownOf(e: Editor): string {
  const storage = e.storage as unknown as { markdown: { getMarkdown: () => string } }
  return storage.markdown.getMarkdown()
}

// P12-2: a numbered equation's opening fence carries its number directly
// (`$3`), no space — read by `equation_marker_like_pattern` on the backend
// to resolve `Equation (3)` cross-references.
describe('block maths numbering (P12-2)', () => {
  it('parses a numbered lone-$ fence', () => {
    const e = mount('$3\nx^2\n$')

    expect(mathLatex(e)).toEqual(['x^2'])
    expect(mathNumbers(e)).toEqual(['3'])
  })

  it('parses a numbered $$ fence, including a dotted number', () => {
    const e = mount('$$3.2\nx^2\n$$')

    expect(mathLatex(e)).toEqual(['x^2'])
    expect(mathNumbers(e)).toEqual(['3.2'])
  })

  it('leaves an unnumbered equation with number: null', () => {
    const e = mount('$\nx^2\n$')

    expect(mathNumbers(e)).toEqual([null])
  })

  it('serializes the number onto the opening fence and leaves the closing fence bare', () => {
    const e = mount('<p></p>')
    e.commands.insertContent({ type: 'blockMath', attrs: { latex: 'x^2', number: '3' } })

    expect(markdownOf(e)).toBe('$3\nx^2\n$')
  })

  it('omits the number entirely when unset, matching the pre-P12-2 fence exactly', () => {
    const e = mount('<p></p>')
    e.commands.insertContent({ type: 'blockMath', attrs: { latex: 'x^2', number: null } })

    expect(markdownOf(e)).toBe('$\nx^2\n$')
  })

  // A fence closes on the bare marker it opened with — repeating the number
  // on the closing line is the same kind of mismatch as opening `$$` and
  // closing `$`, and is treated the same way: it doesn't close there.
  it('does not close a numbered fence on a line that repeats the number', () => {
    const e = mount('$3\nx^2\n$3\n\nmore prose')

    expect(mathLatex(e)).toEqual([])
  })
})
