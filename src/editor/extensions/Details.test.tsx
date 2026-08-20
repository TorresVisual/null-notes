import { describe, it, expect, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { useEffect } from 'react'
import { coreExtensions } from './index'

let editor: Editor | null = null

function TestEditor({ onReady }: { onReady: (editor: Editor) => void }) {
  const instance = useEditor({ extensions: coreExtensions, content: '<p></p>' })
  useEffect(() => {
    if (instance) onReady(instance)
  }, [instance])
  return <EditorContent editor={instance} />
}

function mount() {
  return render(<TestEditor onReady={(e) => { editor = e }} />)
}

function getSummary(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.details-summary')
  if (!el) throw new Error('details-summary not found')
  return el as HTMLElement
}

function isOpen(container: HTMLElement): boolean {
  return container.querySelector('.details-wrapper.open') !== null
}

function detailsRange(instance: Editor): { start: number; end: number } {
  let start = -1
  let end = -1
  instance.state.doc.descendants((node, pos) => {
    if (node.type.name === 'details') {
      start = pos
      end = pos + node.nodeSize
    }
    return true
  })
  return { start, end }
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('details collapse/expand', () => {
  it('toggles open/closed on clicking the summary', async () => {
    const user = userEvent.setup()
    const { container } = mount()
    editor!.commands.insertContent({
      type: 'details',
      attrs: { summary: 'Proof' },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body text' }] }],
    })
    await waitFor(() => expect(isOpen(container)).toBe(true))

    await user.click(getSummary(container))
    await waitFor(() => expect(isOpen(container)).toBe(false))

    await user.click(getSummary(container))
    await waitFor(() => expect(isOpen(container)).toBe(true))
  })

  it('moves the cursor out of the body when collapsing while it was selected inside', async () => {
    const user = userEvent.setup()
    const { container } = mount()
    editor!.commands.insertContent({
      type: 'details',
      attrs: { summary: 'Proof' },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body text' }] }],
    })
    await waitFor(() => expect(isOpen(container)).toBe(true))

    const { start, end } = detailsRange(editor!)
    // Somewhere inside the body paragraph's text.
    const insidePos = start + 3
    editor!.commands.setTextSelection(insidePos)
    expect(editor!.state.selection.from).toBeGreaterThanOrEqual(start)
    expect(editor!.state.selection.from).toBeLessThanOrEqual(end)

    await user.click(getSummary(container))
    await waitFor(() => expect(isOpen(container)).toBe(false))

    const { from, to } = editor!.state.selection
    const stillInside = from >= start && to <= end
    expect(stillInside).toBe(false)
  })

  it('leaves the selection alone when collapsing while the cursor was elsewhere', async () => {
    const user = userEvent.setup()
    const { container } = mount()
    editor!.commands.insertContent({
      type: 'details',
      attrs: { summary: 'Proof' },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body text' }] }],
    })
    await waitFor(() => expect(isOpen(container)).toBe(true))

    // insertContent left a trailing empty paragraph after the details node
    // (the doc's original sole paragraph, split around the inserted block) —
    // that's a real position genuinely outside the details node's range.
    const { end } = detailsRange(editor!)
    editor!.commands.setTextSelection(end + 1)
    const before = editor!.state.selection.from
    expect(before).toBeGreaterThanOrEqual(end)

    await user.click(getSummary(container))
    await waitFor(() => expect(isOpen(container)).toBe(false))

    expect(editor!.state.selection.from).toBe(before)
  })
})
