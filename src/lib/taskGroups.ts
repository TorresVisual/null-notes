import type { OpenTask } from '../types'

export interface TaskGroup {
  notePath: string
  noteTitle: string
  tasks: OpenTask[]
}

// The backend already orders open tasks by note title then line position
// (P9-1's `open_tasks` query), so grouping here only has to preserve arrival
// order rather than re-sort.
export function groupByNote(tasks: OpenTask[]): TaskGroup[] {
  const groups: TaskGroup[] = []
  const byPath = new Map<string, TaskGroup>()
  for (const task of tasks) {
    let group = byPath.get(task.notePath)
    if (!group) {
      group = { notePath: task.notePath, noteTitle: task.noteTitle, tasks: [] }
      byPath.set(task.notePath, group)
      groups.push(group)
    }
    group.tasks.push(task)
  }
  return groups
}
