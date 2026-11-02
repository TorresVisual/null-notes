import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { useEffect } from 'react'
import { coreExtensions } from './index'

vi.mock('../../lib/diagram', () => ({
  diagramApi: {
    ensureDir: () => Promise.resolve('/ws/N.diagrams'),
    read: () => Promise.resolve('<svg></svg>'),
    write: () => Promise.resolve(),
  },
}))

let editor: Editor | null = null

function TestEditor({ content, editable = true }: { content: string; editable?: boolean }) {
  const instance = useEditor({ extensions: coreExtensions, content, editable })
  useEffect(() => {
    if (instance) editor = instance
  }, [instance])
  return <EditorContent editor={instance} />
}

afterEach(() => {
  editor?.destroy()
  editor = null
  cleanup()
})

describe('mounting a diagram block in a real React editor', () => {
  it('renders the static preview without throwing', async () => {
    const fence =
      '```diagram\n{"jsonSrc":"/ws/N.diagrams/d.excalidraw","svgSrc":"/ws/N.diagrams/d.svg","width":700,"height":500}\n```'
    const { container } = render(<TestEditor content={fence} />)

    await waitFor(() => expect(editor).not.toBeNull())
    await waitFor(() => expect(container.querySelector('[data-node-view-wrapper]')).not.toBeNull())
    await waitFor(() => expect(container.querySelector('.diagram-block-preview')).not.toBeNull())
    // The interactive editor must not mount until the preview is clicked.
    expect(container.querySelector('.diagram-editor-overlay')).toBeNull()
  })
})

describe('a diagram block in a read-only editor', () => {
  it('offers no Edit button', async () => {
    const fence =
      '```diagram\n{"jsonSrc":"/ws/N.diagrams/d.excalidraw","svgSrc":"/ws/N.diagrams/d.svg","width":700,"height":500}\n```'
    const { container } = render(<TestEditor content={fence} editable={false} />)

    await waitFor(() => expect(container.querySelector('.diagram-block-preview')).not.toBeNull())
    expect(container.querySelector('.diagram-block-edit')).toBeNull()
  })
})

describe('a numbered diagram block', () => {
  const fence =
    '```diagram\n{"jsonSrc":"/ws/N.diagrams/d.excalidraw","svgSrc":"/ws/N.diagrams/d.svg","width":700,"height":500,"number":"2"}\n```'

  it('round-trips its number through Markdown and exposes it as data-number', async () => {
    const { container } = render(<TestEditor content={fence} />)

    await waitFor(() => expect(container.querySelector('.diagram-block[data-number="2"]')).not.toBeNull())
    const markdown = (editor?.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown()
    expect(markdown).toContain('"height":500,"number":"2"}\n```')
  })
})

describe('a numbered image', () => {
  it('round-trips its number as an <img data-number> tag', async () => {
    const { container } = render(<TestEditor content={'<img src="a.png" alt="x" data-number="3.1">'} />)

    await waitFor(() => expect(container.querySelector('.note-image[data-number="3.1"]')).not.toBeNull())
    const markdown = (editor?.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown()
    expect(markdown).toContain('<img src="a.png" alt="x" data-number="3.1">')
  })
})
