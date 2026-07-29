import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { coreExtensions } from './index'
import { encodeSrc, decodeSrc } from './NoteImage'

let editor: Editor | null = null

function mount(content: string): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: coreExtensions,
    content,
  })
  return editor
}

interface MarkdownStorage {
  getMarkdown: () => string
}

function markdown(instance: Editor): string {
  const storage = instance.storage as unknown as { markdown: MarkdownStorage }
  return storage.markdown.getMarkdown()
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

// A node without its own markdown serializer degrades to escaped plain text,
// which is data loss that only shows up on the next reload. These are the
// guard for that.
describe('note images', () => {
  // A note title with a space is the normal case, not the edge case, so the
  // encoded destination is what actually gets written to every such note.
  it('round-trips a sidecar path containing spaces', () => {
    const e = mount('![diagram](Lecture%207.assets/image-1.png)')
    expect(markdown(e)).toBe('![diagram](Lecture%207.assets/image-1.png)')
  })

  it('round-trips an image with no alt text', () => {
    const e = mount('![](Note.assets/image-2.png)')
    expect(markdown(e)).toBe('![](Note.assets/image-2.png)')
  })

  it('round-trips an external image', () => {
    const e = mount('![logo](https://example.com/logo.png)')
    expect(markdown(e)).toBe('![logo](https://example.com/logo.png)')
  })

  it('keeps an image that sits inline in a sentence', () => {
    const e = mount('see ![fig](Note.assets/a.png) here')
    expect(markdown(e)).toBe('see ![fig](Note.assets/a.png) here')
  })

  it('parses the image into a real node rather than leaving literal text', () => {
    const e = mount('![diagram](Note.assets/image-1.png)')
    let found: Record<string, unknown> | null = null
    e.state.doc.descendants((node) => {
      if (node.type.name === 'image') found = node.attrs
      return true
    })
    expect(found).toMatchObject({ src: 'Note.assets/image-1.png', alt: 'diagram' })
  })

  // The attribute is what the node view hands to the filesystem, so it has to
  // be the real path — not the escaped spelling Markdown needs.
  it('parses an encoded destination back into the raw filesystem path', () => {
    const e = mount(`![fig](${encodeSrc('Lecture 7.assets/image-1.png')})`)

    let found: Record<string, unknown> | null = null
    e.state.doc.descendants((node) => {
      if (node.type.name === 'image') found = node.attrs
      return true
    })

    expect(found).toMatchObject({ src: 'Lecture 7.assets/image-1.png' })
  })

  // Guards the bug that encodeURI-on-an-encoded-path caused: %20 -> %2520,
  // growing the destination on every single save.
  it('does not re-escape the destination on repeated save cycles', () => {
    const once = mount('![fig](Lecture%207.assets/image-1.png)')
    const first = markdown(once)
    once.destroy()

    const twice = mount(first)
    expect(markdown(twice)).toBe(first)
    expect(first).toBe('![fig](Lecture%207.assets/image-1.png)')
  })

  it('survives a filename whose percent sign is not an escape sequence', () => {
    expect(decodeSrc('Note.assets/100%.png')).toBe('Note.assets/100%.png')
  })
})
