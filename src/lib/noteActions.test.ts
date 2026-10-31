import { describe, it, expect, vi, beforeEach } from 'vitest'
import { copyNotePath } from './noteActions'
import { writeToClipboard } from './clipboard'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'

vi.mock('./tauri', () => ({ api: { notes: {} } }))
vi.mock('./clipboard', () => ({ writeToClipboard: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

const WS = String.raw`C:\ws`
const NOTE = String.raw`C:\ws\Course\Lecture 7.md`

beforeEach(() => {
  vi.mocked(writeToClipboard).mockClear()
  useNotesStore.setState({ notes: [] })
  useWorkspaceStore.setState({ path: WS })
})

describe('copyNotePath', () => {
  it('copies the absolute path as-is', async () => {
    await copyNotePath(NOTE, 'absolute')
    expect(writeToClipboard).toHaveBeenCalledWith(NOTE)
  })

  it('copies a workspace-relative path with forward slashes', async () => {
    await copyNotePath(NOTE, 'relative')
    expect(writeToClipboard).toHaveBeenCalledWith('Course/Lecture 7.md')
  })
})
