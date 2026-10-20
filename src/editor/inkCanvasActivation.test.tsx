import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { NoteEditor } from './NoteEditor'
import { useInkStore } from '../store/ink'

vi.mock('../lib/ink', () => ({
  inkApi: {
    ensureDir: () => Promise.resolve('/ws/N.ink'),
    read: () => Promise.resolve(null),
    write: () => Promise.resolve(),
  },
}))

beforeEach(() => useInkStore.setState({ activeCanvas: null, activeCanvasId: null }))
afterEach(cleanup)

// Canvas registration (activeCanvas.test.tsx) and the caret-into-text clear
// rule (editorToolbar.test.tsx) are each proven in isolation — one mounts a
// bare `InkCanvas`, the other mounts `NoteEditor` with no canvas at all.
// Neither exercises the composed case: a real `inkBlock` inside a real
// `NoteEditor`, where a press into the canvas has to register it as active
// without being read back by NoteEditor's own `selectionUpdate` handler as a
// caret landing in prose — which would clear the very registration the press
// just made.
describe('an ink canvas mounted inside a real NoteEditor', () => {
  it('registers as active on pointerdown and stays active', async () => {
    const fence = '```ink\n{"src":"/ws/N.ink/a.svg","width":700,"height":400,"inline":true}\n```'
    const { container } = render(
      <NoteEditor
        content={fence}
        notePath="/ws/N.md"
        spellcheck={false}
        spellcheckLanguage="en"
        onChange={() => {}}
        onFlashcardCommand={() => {}}
      />,
    )

    const canvas = await waitFor(() => {
      const el = container.querySelector('canvas')
      if (!el) throw new Error('ink canvas not mounted')
      return el
    })

    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 })

    await waitFor(() => expect(useInkStore.getState().activeCanvasId).toBe('/ws/N.ink/a.svg'))

    // Held, not merely reached: if the press were misread as a ProseMirror
    // selection change, NoteEditor's selectionUpdate handler would clear the
    // slot on its next tick. Asserting again after yielding to the event loop
    // is what tells apart "stayed active" from "was active for one instant".
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useInkStore.getState().activeCanvasId).toBe('/ws/N.ink/a.svg')
    expect(useInkStore.getState().activeCanvas).not.toBeNull()
  })
})
