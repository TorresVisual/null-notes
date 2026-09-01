import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FlashcardTypeDialog } from './FlashcardTypeDialog'

describe('FlashcardTypeDialog', () => {
  it('inserts the Q&A stub', () => {
    const onPick = vi.fn()
    render(<FlashcardTypeDialog onPick={onPick} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Q&A'))
    expect(onPick).toHaveBeenCalledWith('Question :: Answer')
  })

  it('inserts the Cloze stub', () => {
    const onPick = vi.fn()
    render(<FlashcardTypeDialog onPick={onPick} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Cloze'))
    expect(onPick).toHaveBeenCalledWith('Text with {{hidden}} span.')
  })

  it('inserts the Multiple choice stub', () => {
    const onPick = vi.fn()
    render(<FlashcardTypeDialog onPick={onPick} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Multiple choice'))
    expect(onPick).toHaveBeenCalledWith(
      'Question ::\n- [ ] Option\n- [x] Correct option\n- [ ] Option',
    )
  })
})
