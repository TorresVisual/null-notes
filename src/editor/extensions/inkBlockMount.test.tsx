import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { useEffect } from 'react'
import { coreExtensions } from './index'

vi.mock('../../lib/ink', () => ({
  inkApi: {
    ensureDir: () => Promise.resolve('/ws/N.ink'),
    read: () => Promise.resolve(null),
    write: () => Promise.resolve(),
  },
}))

let editor: Editor | null = null

function TestEditor({ content }: { content: string }) {
  const instance = useEditor({ extensions: coreExtensions, content })
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

// A React node view has to render a NodeViewWrapper; ReactNodeViewRenderer
// throws "Please use the NodeViewWrapper component for your node view" from
// its own `get dom()` otherwise. InkBlock renders InkCanvas, which puts a
// plain <div class="ink-canvas-wrap"> at its root — so mounting one throws,
// and that is what Split Into Tasks hit the moment it started creating ink
// blocks for every solution.
describe('mounting an ink block in a real React editor', () => {
  it('renders without throwing', async () => {
    const fence = '```ink\n{"src":"/ws/N.ink/a.svg","width":700,"height":400}\n```'
    const { container } = render(<TestEditor content={fence} />)

    await waitFor(() => expect(editor).not.toBeNull())
    // The precise thing that was missing: ReactNodeViewRenderer looks this
    // attribute up to find the node's DOM, and throws without it.
    await waitFor(() => expect(container.querySelector('[data-node-view-wrapper]')).not.toBeNull())
    expect(container.querySelector('.ink-canvas-wrap')).not.toBeNull()
  })
})
