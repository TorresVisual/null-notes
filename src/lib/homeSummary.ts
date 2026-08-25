export interface HomeSummaryInput {
  taskCount: number
  dueCount: number
  gitStatus: string | null
}

// Every count HomeView already computes, synthesized into one sentence —
// no new data, just an argument for why the five sections below it belong
// together. gitStatus === null (not a repo) and gitStatus === 'Up to date'
// (clean repo) are kept as two distinct empty-summary sentences: the second
// would be a false claim about Git for a workspace that isn't one.
export function buildHomeSummary({ taskCount, dueCount, gitStatus }: HomeSummaryInput): string {
  const clauses: string[] = []
  if (taskCount > 0) clauses.push(`${taskCount} task${taskCount === 1 ? '' : 's'} open`)
  if (dueCount > 0) clauses.push(`${dueCount} card${dueCount === 1 ? '' : 's'} due`)
  if (gitStatus !== null && gitStatus !== 'Up to date') clauses.push(gitStatus)

  if (clauses.length === 0) {
    return gitStatus === null
      ? 'Nothing outstanding right now.'
      : "Nothing outstanding — everything's up to date."
  }
  return `${clauses.join(', ')}.`
}
