import { describe, it, expect, vi, beforeEach } from 'vitest'
import { copyNotePath, renameCanvas } from './noteActions'
import { api } from './tauri'
import { promptText } from '../store/promptDialog'
import { refreshTree } from '../hooks/useWorkspace'
import { writeToClipboard } from './clipboard'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'

vi.mock('./tauri', () => ({ api: { notes: {}, canvas: { rename: vi.fn() } } }))
vi.mock('../store/promptDialog', () => ({ promptText: vi.fn() }))
vi.mock('../hooks/useWorkspace', () => ({ refreshTree: vi.fn() }))
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

describe('renameCanvas', () => {
  const OLD = String.raw`C:\ws\Notes\old.canvas`
  const NEW = String.raw`C:\ws\Notes\new.canvas`

  beforeEach(() => {
    vi.mocked(api.canvas.rename).mockReset().mockResolvedValue(NEW)
    vi.mocked(promptText).mockReset()
    vi.mocked(refreshTree).mockClear()
    useWorkspaceStore.setState({
      openTabs: [OLD],
      activeTab: OLD,
      canvasViewports: { [OLD]: { x: 1, y: 2, zoom: 1 } },
      gitPendingPaths: [],
      folderError: null,
    })
  })

  it('prompts with the current name, renames, and repoints the open tab and viewport', async () => {
    vi.mocked(promptText).mockResolvedValue('new')

    await renameCanvas(OLD)

    expect(promptText).toHaveBeenCalledWith('New canvas name:', 'old')
    expect(api.canvas.rename).toHaveBeenCalledWith(WS, OLD, 'new')
    expect(useWorkspaceStore.getState().openTabs).toEqual([NEW])
    expect(Object.keys(useWorkspaceStore.getState().canvasViewports)).toEqual([NEW])
    expect(useWorkspaceStore.getState().gitPendingPaths).toEqual(expect.arrayContaining([OLD, NEW]))
    expect(refreshTree).toHaveBeenCalled()
  })

  it('does nothing when the prompt is cancelled or the name is unchanged', async () => {
    vi.mocked(promptText).mockResolvedValueOnce(null)
    await renameCanvas(OLD)
    vi.mocked(promptText).mockResolvedValueOnce('old')
    await renameCanvas(OLD)

    expect(api.canvas.rename).not.toHaveBeenCalled()
  })

  it('reports a failed rename and leaves the tab alone', async () => {
    vi.mocked(promptText).mockResolvedValue('new')
    vi.mocked(api.canvas.rename).mockRejectedValue(new Error('already exists'))

    await renameCanvas(OLD)

    expect(useWorkspaceStore.getState().openTabs).toEqual([OLD])
    expect(useWorkspaceStore.getState().folderError).toBe('already exists')
  })
})
