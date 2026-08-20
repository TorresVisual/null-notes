import { useEffect, useMemo, useState } from 'react'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { api } from '../lib/tauri'
import type { OpenTask, DueCard } from '../types'

const SECTION_CAP = 5

function tabLabel(path: string): string {
  return path.split(/[\\/]/).pop()?.replace('.md', '') ?? path
}

interface HomeViewProps {
  onOpenTaskView: () => void
  onOpenReview: () => void
  onOpenSettings: () => void
}

export function HomeView({ onOpenTaskView, onOpenReview, onOpenSettings }: HomeViewProps) {
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

  useEffect(() => {
    if (!workspacePath) return
    api.notes.listOpenTasks(workspacePath).then(setTasks)
  }, [workspacePath])

  const taskItems = tasks.slice(0, SECTION_CAP)

  const [dueCards, setDueCards] = useState<DueCard[]>([])

  useEffect(() => {
    if (!workspacePath) return
    api.notes.listDueCards(workspacePath).then(setDueCards)
  }, [workspacePath])

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
      <section className="home-section">
        <h2>Continue</h2>
        {continueItems.length === 0 ? (
          <p className="home-empty">No open notes.</p>
        ) : (
          <ul>
            {continueItems.map((path) => (
              <li key={path}>
                <button className="home-section-item" onClick={() => setActiveTab(path)}>
                  {tabLabel(path)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="home-section">
        <h2>Recent</h2>
        {recentItems.length === 0 ? (
          <p className="home-empty">No notes yet.</p>
        ) : (
          <ul>
            {recentItems.map((note) => (
              <li key={note.path}>
                <button className="home-section-item" onClick={() => openTab(note.path)}>
                  {note.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="home-section">
        <h2>Tasks</h2>
        {tasks.length === 0 ? (
          <p className="home-empty">No open tasks.</p>
        ) : (
          <>
            <p className="home-count">{tasks.length} open</p>
            <ul>
              {taskItems.map((task) => (
                <li key={`${task.notePath}:${task.position}`}>
                  <button className="home-section-item" onClick={() => openTab(task.notePath)}>
                    {task.text}
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
        <h2>Study</h2>
        {dueCards.length === 0 ? (
          <p className="home-empty">Nothing due.</p>
        ) : (
          <>
            <p className="home-count">{dueCards.length} due</p>
            <button className="home-view-all" onClick={onOpenReview}>
              Start review
            </button>
          </>
        )}
      </section>
      <section className="home-section">
        <h2>Git</h2>
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
    </div>
  )
}
