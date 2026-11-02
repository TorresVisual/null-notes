import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmptyWorkspace } from './EmptyWorkspace'
import { useCreateNote } from '../hooks/useCreateNote'
import { SAMPLE_NOTE_CONTENT, SAMPLE_NOTE_TITLE } from '../lib/sampleNote'

vi.mock('../hooks/useCreateNote')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('EmptyWorkspace', () => {
  it('creates the sample note with its seeded content on click', async () => {
    const createNote = vi.fn().mockResolvedValue(null)
    vi.mocked(useCreateNote).mockReturnValue(createNote)
    render(<EmptyWorkspace />)

    await userEvent.click(screen.getByRole('button', { name: /create a sample note/i }))

    expect(createNote).toHaveBeenCalledWith(SAMPLE_NOTE_TITLE, SAMPLE_NOTE_CONTENT)
  })
})
