import { confirm, open, save } from '@tauri-apps/plugin-dialog'
import { api } from './tauri'
import { writeToClipboard } from './clipboard'
import { isBasePath } from './canvasPath'
import { failure } from './failure'
import { folderName, isUnderPath, sidecarDir } from './pathPrefix'
import { noteFileName } from './folderTree'
import { topLevelPaths } from './treeSelection'
import type { TrashEntry } from '../types'
import { refreshTree } from '../hooks/useWorkspace'
import { offerUndoDelete, restoreFromTrash } from '../hooks/useTrash'
import { promptText } from '../store/promptDialog'
import { showToast } from '../store/toast'
import { useNotesStore } from '../store/notes'
import { useWorkspaceStore } from '../store/workspace'

const SIDECAR_SUFFIXES = ['ink', 'pdf', 'diagrams', 'assets']

function workspaceOf(path: string): string | null {
  return useNotesStore.getState().notes.find((n) => n.path === path)?.workspace ?? useWorkspaceStore.getState().path
}

// A bare move/rename shows up to git as a removal at the old path plus an
// addition at the new one, and the sidecars travel with the note.
export function queueGitPaths(...paths: string[]) {
  const { addGitPendingPath } = useWorkspaceStore.getState()
  for (const path of paths) {
    for (const suffix of SIDECAR_SUFFIXES) addGitPendingPath(sidecarDir(path, suffix))
    addGitPendingPath(path)
  }
}

function reportError(err: unknown) {
  useWorkspaceStore.getState().setFolderError(err instanceof Error ? err.message : String(err))
}

export async function moveNoteInto(notePath: string, destFolder: string, workspace: string): Promise<string> {
  const newPath = await api.notes.moveNote(notePath, destFolder, workspace)
  useWorkspaceStore.getState().replaceOpenPath(notePath, newPath)
  queueGitPaths(notePath, newPath)
  return newPath
}

export async function renameNote(path: string): Promise<void> {
  const workspace = workspaceOf(path)
  const current = noteFileName(path)
  if (!workspace || !current) return
  const newTitle = await promptText('New title:', current)
  if (!newTitle || newTitle === current) return
  try {
    const renamed = await api.notes.rename(path, newTitle, workspace)
    useWorkspaceStore.getState().setFolderError(null)
    // rename_note moves the file (and its sidecars) to match the new title,
    // so open tabs and .workspace.json must be repointed, not just told a
    // rename happened.
    if (renamed.path !== path) useWorkspaceStore.getState().replaceOpenPath(path, renamed.path)
    queueGitPaths(path, renamed.path)
    await refreshTree()
  } catch (err) {
    reportError(err)
  }
}

export async function renameCanvas(path: string): Promise<void> {
  const workspace = workspaceOf(path)
  const current = folderName(path).replace(/\.(canvas|base)$/, '')
  if (!workspace) return
  const newName = await promptText(isBasePath(path) ? 'New base name:' : 'New canvas name:', current)
  if (!newName || newName === current) return
  try {
    const renamedPath = await api.canvas.rename(workspace, path, newName)
    useWorkspaceStore.getState().setFolderError(null)
    useWorkspaceStore.getState().replaceOpenPath(path, renamedPath)
    useWorkspaceStore.getState().addGitPendingPath(path)
    useWorkspaceStore.getState().addGitPendingPath(renamedPath)
    await refreshTree()
  } catch (err) {
    reportError(err)
  }
}

export async function deleteNote(path: string): Promise<void> {
  const workspace = workspaceOf(path)
  if (!workspace) return
  let trashed
  try {
    trashed = await api.notes.delete(workspace, path)
  } catch (err) {
    reportError(err)
    return
  }
  const { setFolderError, closeTab } = useWorkspaceStore.getState()
  setFolderError(null)
  useNotesStore.getState().removeNote(path)
  const { canvases, setCanvases } = useNotesStore.getState()
  setCanvases(canvases.filter((p) => p !== path))
  closeTab(path)
  // Otherwise the deletion never enters the auto-commit's pathspec-scoped
  // pending list and `git rm` never runs.
  queueGitPaths(path)
  offerUndoDelete(workspace, trashed)
}

async function moveFolderInto(folderPath: string, destFolder: string): Promise<void> {
  const separator = destFolder.includes('\\') ? '\\' : '/'
  const newPath = `${destFolder}${separator}${folderName(folderPath)}`
  await api.notes.renameFolder(folderPath, newPath)
  useWorkspaceStore.getState().replaceOpenPath(folderPath, newPath)
  useWorkspaceStore.getState().addGitPendingPath(folderPath)
  useWorkspaceStore.getState().addGitPendingPath(newPath)
}

function describeFailure(path: string, err: unknown): string {
  return `${folderName(path)}: ${err instanceof Error ? err.message : String(err)}`
}

// Each item succeeds or fails alone: a name collision on one rejects only that
// item and the rest still move.
export async function moveSelectionInto(selected: string[], destFolder: string, workspace: string): Promise<void> {
  const noteDirectory = new Set(useNotesStore.getState().notes.map((n) => n.path))
  const failures: string[] = []
  for (const path of topLevelPaths(selected)) {
    if (isUnderPath(destFolder, path)) continue
    try {
      if (noteDirectory.has(path)) await moveNoteInto(path, destFolder, workspace)
      else await moveFolderInto(path, destFolder)
    } catch (err) {
      failures.push(describeFailure(path, err))
    }
  }
  useWorkspaceStore.getState().setFolderError(failures.length > 0 ? failures.join('\n') : null)
  useWorkspaceStore.getState().clearSelection()
  await refreshTree()
}

export async function deleteSelection(selected: string[]): Promise<void> {
  const workspace = useWorkspaceStore.getState().path
  const paths = topLevelPaths(selected)
  if (!workspace || paths.length === 0) return
  const noun = paths.length === 1 ? 'item' : 'items'
  if (!(await confirm(`Delete ${paths.length} ${noun}? You can restore them from Trash.`))) return
  const noteDirectory = new Set(useNotesStore.getState().notes.map((n) => n.path))
  const trashed: TrashEntry[] = []
  const failures: string[] = []
  for (const path of paths) {
    try {
      const isNote = noteDirectory.has(path)
      trashed.push(isNote ? await api.notes.delete(workspace, path) : await api.notes.deleteFolder(workspace, path))
      useWorkspaceStore.getState().closeTabsUnder(path)
      if (isNote) queueGitPaths(path)
      else useWorkspaceStore.getState().addGitPendingPath(path)
    } catch (err) {
      failures.push(describeFailure(path, err))
    }
  }
  useWorkspaceStore.getState().setFolderError(failures.length > 0 ? failures.join('\n') : null)
  useWorkspaceStore.getState().clearSelection()
  await refreshTree()
  if (trashed.length === 0) return
  showToast(`Deleted ${trashed.length} ${trashed.length === 1 ? 'item' : 'items'}`, {
    label: 'Undo',
    onClick: () => {
      Promise.all(trashed.map((entry) => restoreFromTrash(workspace, entry))).catch((err) =>
        showToast(failure('restore the deleted items', err)),
      )
    },
  })
}

export async function mergeNotes(source: string, dest: string): Promise<void> {
  const workspace = workspaceOf(source)
  if (!workspace) return
  let outcome
  try {
    outcome = await api.notes.merge(workspace, source, dest)
  } catch (err) {
    reportError(err)
    return
  }
  const { setFolderError, closeTab, openTab } = useWorkspaceStore.getState()
  setFolderError(null)
  useNotesStore.getState().removeNote(source)
  closeTab(source)
  openTab(dest)
  queueGitPaths(source, ...outcome.snapshots.map((s) => s.path))
  await refreshTree()
  const title = useNotesStore.getState().notes.find((n) => n.path === dest)?.title ?? 'note'
  showToast(`Merged "${outcome.trash.name}" into "${title}"`, {
    label: 'Undo',
    onClick: () => {
      api.notes
        .undoMerge(workspace, outcome.trash.id, outcome.snapshots)
        .then(async (restored) => {
          queueGitPaths(restored, ...outcome.snapshots.map((s) => s.path))
          await refreshTree()
        })
        .catch(reportError)
    },
  })
}

export async function duplicateNote(path: string): Promise<void> {
  const workspace = workspaceOf(path)
  if (!workspace) return
  try {
    const copy = await api.notes.duplicate(path, workspace)
    useWorkspaceStore.getState().setFolderError(null)
    queueGitPaths(copy.path)
    await refreshTree()
    useWorkspaceStore.getState().openTab(copy.path)
  } catch (err) {
    reportError(err)
  }
}

export async function moveNoteViaPicker(path: string): Promise<void> {
  const workspace = workspaceOf(path)
  if (!workspace) return
  const picked = await open({ directory: true, defaultPath: workspace, title: 'Move note to…' })
  if (typeof picked !== 'string') return
  if (!isUnderPath(picked, workspace)) {
    reportError('Pick a folder inside the workspace.')
    return
  }
  try {
    await moveNoteInto(path, picked, workspace)
    useWorkspaceStore.getState().setFolderError(null)
    await refreshTree()
  } catch (err) {
    reportError(err)
  }
}

export async function exportZip(path: string): Promise<void> {
  const workspace = workspaceOf(path)
  if (!workspace) return
  const name = folderName(path).replace(/\.md$/, '')
  const dest = await save({ defaultPath: `${name}.zip`, filters: [{ name: 'Zip archive', extensions: ['zip'] }] })
  if (!dest) return
  try {
    await api.notes.exportZip(workspace, path, dest)
    showToast(`Exported "${name}.zip"`)
  } catch (e) {
    showToast(failure('export the zip', e))
  }
}

export async function revealNote(path: string): Promise<void> {
  const workspace = workspaceOf(path)
  if (workspace) await api.notes.reveal(workspace, path).catch(reportError)
}

export async function openNoteExternally(path: string): Promise<void> {
  const workspace = workspaceOf(path)
  if (workspace) await api.notes.openExternally(workspace, path).catch(reportError)
}

export async function copyNotePath(path: string, kind: 'absolute' | 'relative'): Promise<void> {
  const workspace = workspaceOf(path)
  const text =
    kind === 'absolute' || !workspace ? path : path.slice(workspace.length).replace(/\\/g, '/').replace(/^\/+/, '')
  await writeToClipboard(text)
  showToast(kind === 'absolute' ? 'Copied path' : 'Copied relative path')
}
