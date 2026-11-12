import { useMemo, type ReactNode } from 'react'
import { Check, ChevronRight, Clock, GitBranch, GitMerge, Layers, ListTodo, Trash2 } from 'lucide-react'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { useActionSheetStore } from '../store/actionSheet'
import { showToast } from '../store/toast'
import { useGitAutoPull } from '../hooks/useGitAutoPull'
import { useDeleteLocalWorkspace } from '../hooks/useDeleteLocalWorkspace'
import { withGitLock } from '../lib/git'
import { api } from '../lib/tauri'
import { failure } from '../lib/failure'
import { noteFolderSegments } from '../lib/pathPrefix'
import { relativeTime } from '../lib/relativeTime'
import type { OpenTask } from '../types'

const RECENT_CAP = 5

interface UpNextRowProps {
  icon: ReactNode
  title: string
  sub: string
  onClick: () => void
  hot?: boolean
}

function UpNextRow({ icon, title, sub, onClick, hot = false }: UpNextRowProps) {
  return (
    <button className={`mobile-home-act${hot ? ' is-hot' : ''}`} onClick={onClick}>
      <span className="mobile-home-act-icon">{icon}</span>
      <span className="mobile-home-body">
        <span className="mobile-home-title">{title}</span>
        <span className="mobile-home-sub">{sub}</span>
      </span>
      <ChevronRight size={18} className="mobile-home-go" />
    </button>
  )
}

interface MobileHomeProps {
  tasks: OpenTask[]
  dueCount: number
  hasCards: boolean
  onOpenTaskView: () => void
  onOpenReview: () => void
  onOpenSettings: () => void
}

export function MobileHome({ tasks, dueCount, hasCards, onOpenTaskView, onOpenReview, onOpenSettings }: MobileHomeProps) {
  const notes = useNotesStore((s) => s.notes)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const workspace = useWorkspaceStore((s) => s.path)
  const repoMode = useWorkspaceStore((s) => s.repoMode)
  const gitDiverged = useWorkspaceStore((s) => s.gitDiverged)
  const gitPendingCount = useWorkspaceStore((s) => s.gitPendingPaths.length)

  const openSheet = useActionSheetStore((s) => s.open)
  const { checkForUpdates } = useGitAutoPull()
  const deleteLocalCopy = useDeleteLocalWorkspace()

  async function rebaseAndSync() {
    if (!workspace) return
    try {
      const outcome = await withGitLock(() => api.git.rebaseOntoRemote(workspace))
      if (outcome.kind === 'aborted') showToast(failure('rebase onto the remote', outcome.output))
    } catch (e) {
      showToast(failure('rebase onto the remote', e))
    }
    await checkForUpdates(workspace)
  }

  function openDivergedSheet() {
    if (!gitDiverged) return
    const { localPaths, remotePaths } = gitDiverged
    const disjoint = localPaths.length > 0 && remotePaths.length > 0 && !localPaths.some((p) => remotePaths.includes(p))
    openSheet({
      title: `${gitDiverged.ahead} ahead, ${gitDiverged.behind} behind`,
      actions: [
        ...(disjoint ? [{ label: 'Rebase and sync', icon: GitMerge, onSelect: () => void rebaseAndSync() }] : []),
        { label: 'Delete local copy…', icon: Trash2, onSelect: () => void deleteLocalCopy(), destructive: true },
      ],
    })
  }

  const sorted = useMemo(() => [...notes].sort((a, b) => b.updatedAt - a.updatedAt), [notes])
  const last = sorted[0]
  const recent = sorted.slice(1, RECENT_CAP + 1)

  if (!last) {
    return (
      <div className="mobile-home">
        <div className="mobile-home-empty">
          <p className="mobile-home-empty-title">No notes yet</p>
          <p>Tap + to jot your first one.</p>
        </div>
      </div>
    )
  }

  const gitAlert = !repoMode
    ? null
    : gitDiverged
      ? `${gitDiverged.ahead} ahead, ${gitDiverged.behind} behind`
      : gitPendingCount > 0
        ? `${gitPendingCount} unpushed`
        : null
  const calm = dueCount === 0 && tasks.length === 0 && !gitAlert
  const calmLine = [hasCards && 'Cards caught up', 'No open tasks', repoMode && 'Git up to date']
    .filter((part): part is string => Boolean(part))
    .join(' · ')
  const firstTask = tasks[0]

  return (
    <div className="mobile-home">
      <h2>Up next</h2>
      <div className="mobile-home-list">
        {dueCount > 0 && (
          <UpNextRow hot icon={<Layers size={18} />} title={`${dueCount} ${dueCount === 1 ? 'card' : 'cards'} due`} sub="Start review" onClick={onOpenReview} />
        )}
        <UpNextRow
          icon={<Clock size={18} />}
          title={`Continue “${last.title}”`}
          sub={`Edited ${relativeTime(last.updatedAt)}`}
          onClick={() => openTab(last.path)}
        />
        {firstTask && (
          <UpNextRow
            icon={<ListTodo size={18} />}
            title={`${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'} open`}
            sub={tasks.length > 1 ? `${firstTask.text}, +${tasks.length - 1}` : firstTask.text}
            onClick={onOpenTaskView}
          />
        )}
        {gitAlert && (
          <UpNextRow
            icon={<GitBranch size={18} />}
            title={gitAlert}
            sub={gitDiverged ? 'Resolve' : 'Open Git settings'}
            onClick={gitDiverged ? openDivergedSheet : onOpenSettings}
          />
        )}
        {calm && (
          <p className="mobile-home-calm">
            <Check size={16} />
            {calmLine}
          </p>
        )}
      </div>
      {recent.length > 0 && (
        <>
          <h2><Clock size={14} /> Recent</h2>
          <div className="mobile-home-list">
            {recent.map((note) => {
              const folder = noteFolderSegments(note.path, workspace).join(' / ')
              return (
                <button key={note.path} className="mobile-home-row" onClick={() => openTab(note.path)}>
                  <span className="mobile-home-body">
                    <span className="mobile-home-title">{note.title}</span>
                    {folder && <span className="mobile-home-sub">{folder}</span>}
                  </span>
                  <span className="mobile-home-meta">{relativeTime(note.updatedAt)}</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
