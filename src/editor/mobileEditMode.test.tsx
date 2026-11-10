import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import { platform } from '@tauri-apps/plugin-os'
import { NoteEditor } from './NoteEditor'
import { useMobileEditStore } from '../store/mobileEdit'

vi.mock('@tauri-apps/plugin-dialog', () => ({
  confirm: vi.fn().mockResolvedValue(false),
  message: vi.fn().mockResolvedValue(undefined),
}))

function mount(content: string, notePath = '/a.md') {
  const props = {
    notePath,
    spellcheck: false,
    spellcheckLanguage: 'en',
    onChange: () => {},
    onFlashcardCommand: () => {},
  }
  const view = render(<NoteEditor content={content} {...props} />)
  return {
    ...view,
    setContent: (next: string) => view.rerender(<NoteEditor content={next} {...props} />),
  }
}

const textbox = () => screen.getByRole('textbox', { name: 'Note' })

beforeEach(() => {
  vi.mocked(platform).mockReturnValue('android')
  useMobileEditStore.setState({ editingPath: null })
})

afterEach(() => {
  cleanup()
  vi.mocked(platform).mockReturnValue('windows')
})

describe('mobile read/edit mode', () => {
  it('opens read-only: not contenteditable and no toolbar', () => {
    mount('hello')
    expect(textbox().getAttribute('contenteditable')).toBe('false')
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('Edit note makes it editable and shows the toolbar; Done reverses both', async () => {
    mount('hello')

    fireEvent.click(screen.getByRole('button', { name: 'Edit note' }))
    await waitFor(() => expect(textbox().getAttribute('contenteditable')).toBe('true'))
    expect(screen.getByRole('toolbar')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(textbox().getAttribute('contenteditable')).toBe('false'))
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('stays read-only while a different note is the one being edited', () => {
    useMobileEditStore.setState({ editingPath: '/other.md' })
    mount('hello', '/a.md')
    expect(textbox().getAttribute('contenteditable')).toBe('false')
    expect(screen.getByRole('button', { name: 'Edit note' })).toBeTruthy()
  })

  it('still applies content that arrives while read-only', async () => {
    const { setContent } = mount('first')
    expect(textbox().textContent).toContain('first')

    setContent('second')
    await waitFor(() => expect(textbox().textContent).toContain('second'))
    expect(textbox().getAttribute('contenteditable')).toBe('false')
  })

  it('is editable with no pencil on desktop', () => {
    vi.mocked(platform).mockReturnValue('windows')
    mount('hello')
    expect(textbox().getAttribute('contenteditable')).toBe('true')
    expect(screen.queryByRole('button', { name: 'Edit note' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull()
  })
})
