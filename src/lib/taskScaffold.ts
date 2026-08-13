/**
 * The `## Task N` / `### Solution` scaffold, counted from what the note
 * already holds.
 *
 * The import pipeline (`pdf/exercises.rs`) creates these at conversion time;
 * this is the other half of the brief's ask — appending the next pair on
 * demand, so how much room a task needs is never something to plan in advance.
 */

/** Task headings as the importer writes them: `## Task 3`, `## Task 9.1`. */
const TASK_HEADING = /^##\s+Task\s+(\d+(?:\.\d+)*)\s*$/gm

/**
 * The label for the task after the last one in `markdown`.
 *
 * Counted from the *last* heading rather than the numerically highest: a sheet
 * whose exercises run 9.1…9.5 continues at 9.6, and the reader's own sense of
 * "the next one" is positional. A note with no tasks yet starts at 1.
 */
export function nextTaskLabel(markdown: string): string {
  const labels = [...markdown.matchAll(TASK_HEADING)].map((match) => match[1]!)
  const last = labels[labels.length - 1]
  if (!last) return '1'

  // A dotted label numbers the sheet in its first component and the exercise
  // in its last, so only the last one advances: 9.5 → 9.6, never 10.5.
  const parts = last.split('.')
  const tail = Number(parts[parts.length - 1])
  if (!Number.isFinite(tail)) return '1'
  parts[parts.length - 1] = String(tail + 1)
  return parts.join('.')
}
