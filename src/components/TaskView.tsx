import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { LoadingStatus } from './LoadingStatus'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import { groupByNote } from '../lib/taskGroups'
import type { OpenTask } from '../types'

interface TaskViewProps {
  onClose: () => void
}

// How long a just-ticked task stays visible (checked + struck through)
// before it's dropped from the list — long enough to register as a
// confirmation, short enough it still reads as "leaving," not stuck.
const TASK_CHECK_FADE_MS = 320

export function TaskView({ onClose }: TaskViewProps) {
  const workspacePath = useWorkspaceStore((s) => s.path)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const [tasks, setTasks] = useState<OpenTask[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [checkingKeys, setCheckingKeys] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!workspacePath) return
    setIsLoading(true)
    api.notes.listOpenTasks(workspacePath).then((t) => {
      setTasks(t)
      setIsLoading(false)
    })
  }, [workspacePath])

  const groups = useMemo(() => groupByNote(tasks), [tasks])

  function openNote(path: string) {
    openTab(path)
    onClose()
  }

  // Ticks the checkbox — done tasks have nothing to show in this view, so a
  // successful toggle just drops it from the local list rather than
  // refetching. The write itself goes through the normal atomic-write +
  // reindex path (`toggle_task`), so the workspace watcher independently
  // reloads or conflict-prompts the note if it's open elsewhere, same as any
  // other external change.
  function toggle(task: OpenTask) {
    if (!workspacePath) return
    const key = `${task.notePath}#${task.position}`
    setCheckingKeys((prev) => new Set(prev).add(key))
    void api.notes.toggleTask(task.notePath, task.position, workspacePath).then(() => {
      setTimeout(() => {
        setTasks((prev) =>
          prev.filter((t) => !(t.notePath === task.notePath && t.position === task.position)),
        )
        setCheckingKeys((prev) => {
          const next = new Set(prev)
          next.delete(key)
          return next
        })
      }, TASK_CHECK_FADE_MS)
    })
  }

  return (
    <div className="search-overlay" onMouseDown={onClose}>
      <div className="task-view" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-panel-header">
          <h2>Tasks</h2>
          <button className="settings-panel-close" onClick={onClose} aria-label="Close tasks" title="Close tasks">
            <X size={16} />
          </button>
        </div>
        {isLoading ? (
          <LoadingStatus />
        ) : groups.length === 0 ? (
          <p className="empty-state">
            No open tasks in this workspace.
            <span className="empty-state-detail">
              Write <code>- [ ] task text</code> in any note to track it here.
            </span>
          </p>
        ) : (
          <div className="task-view-list">
            {groups.map((group) => (
              <div key={group.notePath} className="task-view-group">
                <button className="task-view-note-title" onClick={() => openNote(group.notePath)}>
                  {group.noteTitle}
                </button>
                <ul>
                  {group.tasks.map((task) => {
                    const checked = checkingKeys.has(`${task.notePath}#${task.position}`)
                    return (
                      <li key={task.position} className={`task-view-item${checked ? ' checked' : ''}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(task)}
                          aria-label={`Mark "${task.text}" done`}
                        />
                        <button className="task-view-item-text" onClick={() => openNote(group.notePath)}>
                          {task.text}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
