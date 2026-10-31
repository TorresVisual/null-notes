import { open } from '@tauri-apps/plugin-dialog'
import { api } from './tauri'
import { writeToClipboard } from './clipboard'
import { isUnderPath, sidecarDir } from './pathPrefix'
import { refreshTree } from '../hooks/useWorkspace'
import { offerUndoDelete } from '../hooks/useTrash'
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
function queueGitPaths(...paths: string[]) {
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
  const current = useNotesStore.getState().notes.find((n) => n.path === path)?.title
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
  closeTab(path)
  // Otherwise the deletion never enters the auto-commit's pathspec-scoped
  // pending list and `git rm` never runs.
  queueGitPaths(path)
  offerUndoDelete(workspace, trashed)
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
