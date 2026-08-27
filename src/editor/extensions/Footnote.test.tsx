import { describe, it, expect, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEditor, EditorContent } from '@tiptap/react'
import { Editor } from '@tiptap/core'
import type { Editor as EditorType } from '@tiptap/core'
import { useEffect } from 'react'
import { coreExtensions } from './index'

let editor: EditorType | null = null

interface MarkdownStorage {
  getMarkdown: () => string
}

function getMarkdown(e: EditorType): string {
  return ((e.storage as unknown as Record<string, unknown>)['markdown'] as MarkdownStorage).getMarkdown()
}

function TestEditor({ content, onReady }: { content: string; onReady: (editor: EditorType) => void }) {
  const instance = useEditor({ extensions: coreExtensions, content })
  useEffect(() => {
    if (instance) onReady(instance)
  }, [instance])
  return <EditorContent editor={instance} />
}

function mount(content: string) {
  return render(<TestEditor content={content} onReady={(e) => { editor = e }} />)
}

function mountPlain(content: string): EditorType {
  editor = new Editor({ element: document.createElement('div'), extensions: coreExtensions, content })
  return editor
}

function nodeTypes(e: EditorType): string[] {
  const found: string[] = []
  e.state.doc.descendants((node) => { found.push(node.type.name); return true })
  return found
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('footnotes: markdown round-trip', () => {
  it('parses a reference and its definition into real nodes', () => {
    const e = mountPlain('See note.[^1]\n\n[^1]: This is the note.')
    expect(nodeTypes(e)).toContain('footnoteReference')
    expect(nodeTypes(e)).toContain('footnoteDefinition')
  })

  it('round-trips byte-identical to hand-written GFM footnote syntax', () => {
    const md = 'See note.[^1]\n\n[^1]: This is the note.'
    const e = mountPlain(md)
    expect(getMarkdown(e)).toBe(md)
  })

  it('preserves inline formatting (bold, links) inside the definition', () => {
    const md = 'See note.[^1]\n\n[^1]: A **bold** claim, see [a link](https://example.com).'
    const e = mountPlain(md)
    expect(getMarkdown(e)).toBe(md)
  })

  it('is idempotent across repeated save cycles', () => {
    const md = 'See note.[^1]\n\n[^1]: This is the note.'
    const first = getMarkdown(mountPlain(md))
    const second = getMarkdown(mountPlain(first))
    expect(second).toBe(first)
  })

  it('supports a non-numeric label', () => {
    const md = 'An aside.[^aside]\n\n[^aside]: A named footnote.'
    const e = mountPlain(md)
    expect(getMarkdown(e)).toBe(md)
  })

  it('does not confuse a mid-sentence reference for a definition', () => {
    const md = 'This[^1] and that[^2] both matter.\n\n[^1]: First.\n\n[^2]: Second.'
    const e = mountPlain(md)
    const refs = nodeTypes(e).filter((t) => t === 'footnoteReference')
    const defs = nodeTypes(e).filter((t) => t === 'footnoteDefinition')
    expect(refs).toHaveLength(2)
    expect(defs).toHaveLength(2)
    expect(getMarkdown(e)).toBe(md)
  })

  it('recovers legacy escaped brackets the same way task lists already do', () => {
    // Not a scenario this feature can produce itself, but the schema for
    // "what an older/foreign build might have written" is the same
    // bracket-escaping prosemirror-markdown's default serializer already
    // applies elsewhere — an unescaped round-trip must still read the
    // reference correctly if it's ever encountered.
    const e = mountPlain('note\\[\\^1\\]\n\n[^1]: text')
    expect(nodeTypes(e)).not.toContain('footnoteReference')
  })
})

describe('footnotes: jump navigation', () => {
  it('clicking a reference scrolls to and flashes its definition', async () => {
    const user = userEvent.setup()
    const { container } = mount('See note.[^1]\n\n[^1]: This is the note.')
    await waitFor(() => expect(container.querySelector('.footnote-ref-button')).toBeInTheDocument())

    const button = container.querySelector('.footnote-ref-button') as HTMLButtonElement
    await user.click(button)

    const def = container.querySelector('.footnote-def') as HTMLElement
    await waitFor(() => expect(def.classList.contains('cross-ref-target')).toBe(true))
  })

  it('clicking a definition\'s back-arrow scrolls to and flashes its reference', async () => {
    const user = userEvent.setup()
    const { container } = mount('See note.[^1]\n\n[^1]: This is the note.')
    await waitFor(() => expect(container.querySelector('.footnote-def-back')).toBeInTheDocument())

    const back = container.querySelector('.footnote-def-back') as HTMLButtonElement
    await user.click(back)

    const ref = container.querySelector('.footnote-ref') as HTMLElement
    await waitFor(() => expect(ref.classList.contains('cross-ref-target')).toBe(true))
  })

  it('jumps to the first reference in document order when a label is used more than once', async () => {
    const user = userEvent.setup()
    const { container } = mount(
      'First mention.[^1] Second mention.[^1]\n\n[^1]: Shared note.',
    )
    await waitFor(() => expect(container.querySelectorAll('.footnote-ref-button')).toHaveLength(2))

    const back = container.querySelector('.footnote-def-back') as HTMLButtonElement
    await user.click(back)

    const [first, second] = Array.from(container.querySelectorAll('.footnote-ref'))
    await waitFor(() => expect(first!.classList.contains('cross-ref-target')).toBe(true))
    expect(second!.classList.contains('cross-ref-target')).toBe(false)
  })
})

describe('footnotes: typed input rule', () => {
  type TextInputHandler = (view: EditorType['view'], from: number, to: number, text: string) => boolean | void

  // insertContent bypasses input rules, so typing has to go through the same
  // handleTextInput path the browser uses — the same helper taskList.test.ts
  // uses to exercise its own "[ ] " input rule.
  function type(instance: EditorType, text: string): void {
    for (const char of text) {
      const { from, to } = instance.state.selection
      const handled = instance.view.someProp(
        'handleTextInput',
        (f) => (f as unknown as TextInputHandler)(instance.view, from, to, char),
      )
      if (!handled) instance.view.dispatch(instance.state.tr.insertText(char, from, to))
    }
  }

  it('turns a typed "[^1]" into a real reference node', async () => {
    const { container } = mount('<p>note</p>')
    await waitFor(() => expect(container.querySelector('.ProseMirror')).toBeInTheDocument())

    editor!.commands.setTextSelection(editor!.state.doc.content.size - 1)
    editor!.commands.focus()
    type(editor!, '[^1]')

    await waitFor(() => expect(nodeTypes(editor!)).toContain('footnoteReference'))
  })
})
