import { describe, it, expect } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { useEffect } from 'react'
import { coreExtensions } from './index'

function TestEditor({ content, onReady }: { content: string; onReady: (editor: Editor) => void }) {
  const instance = useEditor({ extensions: coreExtensions, content })
  useEffect(() => {
    if (instance) onReady(instance)
  }, [instance])
  return <EditorContent editor={instance} />
}

describe('plot block', () => {
  const source = '```plot\nx^2\nn log n\nx: 1..50\n```'

  it('renders a curve per expression and round-trips through markdown', async () => {
    let editor: Editor | null = null
    const { container } = render(<TestEditor content={source} onReady={(e) => { editor = e }} />)
    await waitFor(() => expect(container.querySelectorAll('.plot-block-svg path')).toHaveLength(2))
    const md = (editor!.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown()
    expect(md.trim()).toBe(source)
  })
})
