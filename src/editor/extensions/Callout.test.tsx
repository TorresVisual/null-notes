import { describe, it, expect, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { useEffect } from 'react'
import { coreExtensions } from './index'

let editor: Editor | null = null

function TestEditor({ content, onReady }: { content: string; onReady: (editor: Editor) => void }) {
  const instance = useEditor({ extensions: coreExtensions, content })
  useEffect(() => {
    if (instance) onReady(instance)
  }, [instance])
  return <EditorContent editor={instance} />
}

function mount(content: string) {
  return render(
    <TestEditor
      content={content}
      onReady={(e) => {
        editor = e
      }}
    />,
  )
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('foldable callouts', () => {
  it('renders [!type]- closed and [!type]+ open, and toggles without touching the markdown', async () => {
    const user = userEvent.setup()
    const { container } = mount('<div data-type="callout" data-callout-type="note" data-callout-foldable="-"><p>Body</p></div>')
    await waitFor(() => expect(container.querySelector('.callout-foldable')).not.toBeNull())
    expect(container.querySelector('.callout-foldable.open')).toBeNull()

    const calloutJson = () => editor!.state.doc.firstChild?.toJSON()
    const before = calloutJson()
    await user.click(container.querySelector('.callout-header') as HTMLElement)
    await waitFor(() => expect(container.querySelector('.callout-foldable.open')).not.toBeNull())
    expect(calloutJson()).toEqual(before)

    await user.click(container.querySelector('.callout-header') as HTMLElement)
    await waitFor(() => expect(container.querySelector('.callout-foldable.open')).toBeNull())
  })

  it('opens a [!type]+ callout initially', async () => {
    const { container } = mount('<div data-type="callout" data-callout-type="faq" data-callout-foldable="+"><p>Body</p></div>')
    await waitFor(() => expect(container.querySelector('.callout-foldable.open')).not.toBeNull())
    expect(container.querySelector('.callout-question')).not.toBeNull()
  })

  it('gives a non-foldable callout no fold affordance', async () => {
    const { container } = mount('<div data-type="callout" data-callout-type="note"><p>Body</p></div>')
    await waitFor(() => expect(container.querySelector('.callout')).not.toBeNull())
    expect(container.querySelector('.callout-chevron')).toBeNull()
  })
})
