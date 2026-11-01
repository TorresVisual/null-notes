import { useEffect, useMemo, useState } from 'react'
import { History, Clock, ListTodo, GraduationCap, GitBranch } from 'lucide-react'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore, noteTitle } from '../store/notes'
import { api } from '../lib/tauri'
import { buildHomeSummary } from '../lib/homeSummary'
import type { OpenTask, DueCard } from '../types'

const SECTION_CAP = 5

function relativeTime(ms: number): string {
  const diffMin = Math.round((Date.now() - ms) / 60_000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return `${Math.round(diffHr / 24)}d ago`
}

interface HomeViewProps {
  onOpenTaskView: () => void
  onOpenReview: () => void
  onOpenDeckView: () => void
  onOpenSettings: () => void
  /** Any overlay closing (review, deck, tasks) can change these counts, so refetch when it does. */
  overlayOpen?: boolean
}

export function HomeView({ onOpenTaskView, onOpenReview, onOpenDeckView, onOpenSettings, overlayOpen = false }: HomeViewProps) {
  const openTabs = useWorkspaceStore((s) => s.openTabs)
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const notes = useNotesStore((s) => s.notes)

  const continueItems = useMemo(
    () => [...openTabs].reverse().slice(0, SECTION_CAP),
    [openTabs],
  )
  const recentItems = useMemo(
    () => [...notes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, SECTION_CAP),
    [notes],
  )

  const workspacePath = useWorkspaceStore((s) => s.path)
  const [tasks, setTasks] = useState<OpenTask[]>([])

  const [dueCards, setDueCards] = useState<DueCard[]>([])

  useEffect(() => {
    if (!workspacePath || overlayOpen) return
    api.notes.listOpenTasks(workspacePath).then(setTasks)
    api.notes.listDueCards(workspacePath).then(setDueCards)
  }, [workspacePath, overlayOpen])

  const taskItems = tasks.slice(0, SECTION_CAP)

  const repoMode = useWorkspaceStore((s) => s.repoMode)
  const gitDiverged = useWorkspaceStore((s) => s.gitDiverged)
  const gitPendingPaths = useWorkspaceStore((s) => s.gitPendingPaths)

  const gitStatus = !repoMode
    ? null
    : gitDiverged
      ? `${gitDiverged.ahead} ahead, ${gitDiverged.behind} behind`
      : gitPendingPaths.length > 0
        ? `${gitPendingPaths.length} unpushed`
        : 'Up to date'

  return (
    <div className="home-view">
      <p className="home-summary">
        {buildHomeSummary({ taskCount: tasks.length, dueCount: dueCards.length, gitStatus })}
      </p>
      <div className="home-layout">
        <div className="home-main">
          <section className="home-section">
            <h2><History size={14} /> Continue</h2>
            {continueItems.length === 0 ? (
              <p className="home-empty">No open notes.</p>
            ) : (
              <ul>
                {continueItems.map((path) => (
                  <li key={path}>
                    <button className="home-section-item" onClick={() => setActiveTab(path)}>
                      {noteTitle(notes, path)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="home-section">
            <h2><Clock size={14} /> Recent</h2>
            {recentItems.length === 0 ? (
              <p className="home-empty">No notes yet.</p>
            ) : (
              <ul>
                {recentItems.map((note) => (
                  <li key={note.path}>
                    <button className="home-section-item" onClick={() => openTab(note.path)}>
                      <span className="home-section-item-label">{note.title}</span>
                      <span className="home-section-item-meta">{relativeTime(note.updatedAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <aside className="home-rail">
          <section className="home-section">
            <div className="home-section-head">
              <h2><ListTodo size={14} /> Tasks</h2>
              {tasks.length > 0 && <span className="home-count">{tasks.length} open</span>}
            </div>
            {tasks.length === 0 ? (
              <p className="home-empty">No open tasks.</p>
            ) : (
              <>
                <ul>
                  {taskItems.map((task) => (
                    <li key={`${task.notePath}:${task.position}`}>
                      <button className="home-section-item" onClick={() => openTab(task.notePath)}>
                        <span className="home-section-item-label">{task.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <button className="home-view-all" onClick={onOpenTaskView}>
                  View all
                </button>
              </>
            )}
          </section>
          <section className="home-section">
            <div className="home-section-head">
              <h2><GraduationCap size={14} /> Study</h2>
              {dueCards.length > 0 && <span className="home-count">{dueCards.length} due</span>}
            </div>
            {dueCards.length === 0 && <p className="home-empty">Nothing due.</p>}
            <div className="home-actions">
              {dueCards.length > 0 && (
                <button className="home-action-primary" onClick={onOpenReview}>
                  Start review
                </button>
              )}
              <button className="home-view-all" onClick={onOpenDeckView}>
                Browse all cards
              </button>
            </div>
          </section>
          <section className="home-section">
            <h2><GitBranch size={14} /> Git</h2>
            {gitStatus ? (
              <p className="home-status">{gitStatus}</p>
            ) : (
              <>
                <p className="home-empty">
                  Not a Git repository.
                  <span className="empty-state-detail">
                    Turn this workspace into one for version history and backups.
                  </span>
                </p>
                <button className="home-view-all" onClick={onOpenSettings}>
                  Open Settings
                </button>
              </>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}
