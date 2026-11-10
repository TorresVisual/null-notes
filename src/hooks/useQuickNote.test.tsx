import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useQuickNote, discardIfUntouched } from './useQuickNote'
import { useMobileEditStore } from '../store/mobileEdit'
import { useNoteBuffers } from '../store/noteBuffers'
import { useNotesStore } from '../store/notes'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'
import { quickNoteTitle } from '../lib/quickNote'
import type { NoteMetadata } from '../types'

vi.mock('../lib/tauri', () => ({
  api: { notes: { create: vi.fn(), delete: vi.fn() } },
}))

vi.mock('../store/noteBuffers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../store/noteBuffers')>()),
  flushAllNotes: vi.fn().mockResolvedValue(undefined),
}))

const NOW = new Date(2026, 10, 10, 14, 32)
const TITLE = quickNoteTitle(NOW)

function metaFor(title: string): NoteMetadata {
  return { id: title, title, path: `/ws/${title}.md`, workspace: '/ws', updatedAt: 0 }
}

function bufferWith(path: string, content: string) {
  useNoteBuffers.setState({
    buffers: {
      [path]: { content, loadedPath: path, failedPath: null, isLoading: false, saveState: 'clean', saveError: null, conflict: false },
    },
  })
}

async function createQuickNote(): Promise<string> {
  const { result } = renderHook(() => useQuickNote())
  await act(() => result.current())
  const path = useMobileEditStore.getState().editingPath
  if (!path) throw new Error('quick note was not created')
  return path
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.mocked(api.notes.create).mockReset().mockImplementation(async (_ws, _folder, title) => metaFor(title))
  vi.mocked(api.notes.delete).mockReset().mockResolvedValue({} as never)
  useMobileEditStore.setState({ editingPath: null })
  useNoteBuffers.setState({ buffers: {} })
  useNotesStore.setState({ notes: [] })
  useWorkspaceStore.setState({ path: '/ws', selectedFolder: null })
})

describe('useQuickNote', () => {
  it('creates a note named for the time and opens it in edit mode', async () => {
    const path = await createQuickNote()

    expect(api.notes.create).toHaveBeenCalledWith('/ws', '/ws', TITLE)
    expect(path).toBe(`/ws/${TITLE}.md`)
  })

  it('creates in the selected folder when one is browsed', async () => {
    useWorkspaceStore.setState({ selectedFolder: '/ws/Lectures' })
    await createQuickNote()

    expect(api.notes.create).toHaveBeenCalledWith('/ws', '/ws/Lectures', TITLE)
  })

  it('creates exactly one note for a double tap', async () => {
    const { result } = renderHook(() => useQuickNote())

    await act(() => Promise.all([result.current(), result.current()]))

    expect(api.notes.create).toHaveBeenCalledTimes(1)
  })
})

describe('discardIfUntouched', () => {
  it('deletes a quick note that still holds only its heading', async () => {
    const path = await createQuickNote()
    bufferWith(path, `# ${TITLE}\n`)

    await discardIfUntouched(path)

    expect(api.notes.delete).toHaveBeenCalledWith('/ws', path)
    expect(useNotesStore.getState().notes.find((n) => n.path === path)).toBeUndefined()
  })

  it('keeps a quick note with text', async () => {
    const path = await createQuickNote()
    bufferWith(path, `# ${TITLE}\n\nhello`)

    await discardIfUntouched(path)

    expect(api.notes.delete).not.toHaveBeenCalled()
  })

  it('deletes a quick note whose text was typed and then erased', async () => {
    const path = await createQuickNote()
    bufferWith(path, `# ${TITLE}\n\nhello`)
    await discardIfUntouched(path)
    bufferWith(path, `# ${TITLE}\n`)

    await discardIfUntouched(path)

    expect(api.notes.delete).toHaveBeenCalledTimes(1)
  })

  it('never deletes a note that was not created by +', async () => {
    bufferWith('/ws/Plain.md', '# Plain\n')

    await discardIfUntouched('/ws/Plain.md')

    expect(api.notes.delete).not.toHaveBeenCalled()
  })

  it('keeps the note when its buffer is not loaded, since nothing proves it is empty', async () => {
    const path = await createQuickNote()

    await discardIfUntouched(path)

    expect(api.notes.delete).not.toHaveBeenCalled()
  })

  it('deletes once when Done and Back both ask', async () => {
    const path = await createQuickNote()
    bufferWith(path, `# ${TITLE}\n`)

    await Promise.all([discardIfUntouched(path), discardIfUntouched(path)])

    expect(api.notes.delete).toHaveBeenCalledTimes(1)
  })
})
