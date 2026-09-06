import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { coreExtensions } from './extensions'
import { EditorStatusBar } from './EditorStatusBar'

let editor: Editor | null = null

function mount(content: string) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  editor = new Editor({ element, extensions: coreExtensions, content })
  return editor
}

afterEach(() => {
  cleanup()
  editor?.destroy()
  editor = null
  vi.useRealTimers()
})

describe('EditorStatusBar word count debounce', () => {
  it('coalesces rapid transactions into one recompute instead of walking the doc on every keystroke', () => {
    vi.useFakeTimers()
    const e = mount('<p>alpha</p>')
    const { getByLabelText } = render(<EditorStatusBar editor={e} />)

    expect(getByLabelText('Editor status').textContent).toContain('1 word')

    // Three keystrokes in quick succession, each firing a 'transaction' event.
    act(() => {
      e.commands.insertContentAt(e.state.doc.content.size - 1, ' b')
      e.commands.insertContentAt(e.state.doc.content.size - 1, 'e')
      e.commands.insertContentAt(e.state.doc.content.size - 1, 't')
    })

    // Still showing the stale count — the doc walk hasn't run yet.
    expect(getByLabelText('Editor status').textContent).toContain('1 word')

    act(() => {
      vi.advanceTimersByTime(150)
    })

    expect(getByLabelText('Editor status').textContent).toContain('2 words')
  })
})
