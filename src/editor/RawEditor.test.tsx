import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { RawEditor } from './RawEditor'
import { rememberPosition, recallPosition } from '../lib/notePositions'

afterEach(cleanup)

describe('RawEditor', () => {
  it('places the caret at the remembered cursor fraction on mount', () => {
    rememberPosition('Caret.md', { cursorFraction: 0.5 })
    const content = '0123456789'

    const { container } = render(
      <RawEditor content={content} notePath="Caret.md" spellcheck spellcheckLanguage="en" onChange={() => {}} />,
    )
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement

    expect(textarea.selectionStart).toBe(5)
    expect(textarea.selectionEnd).toBe(5)
  })

  it('records the caret position as a fraction of the content length', () => {
    const content = '01234567890123456789'

    const { container } = render(
      <RawEditor content={content} notePath="RecordCaret.md" spellcheck spellcheckLanguage="en" onChange={() => {}} />,
    )
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement

    textarea.setSelectionRange(10, 10)
    fireEvent.select(textarea)

    expect(recallPosition('RecordCaret.md')?.cursorFraction).toBe(0.5)
  })
})
