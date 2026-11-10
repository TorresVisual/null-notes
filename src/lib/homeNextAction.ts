export type HomeNextAction =
  | { kind: 'review'; dueCount: number }
  | { kind: 'resume'; path: string; caughtUp: boolean }
  | null

interface HomeNextActionInput {
  dueCount: number
  hasCards: boolean
  lastEdited: { path: string } | null
}

export function homeNextAction({ dueCount, hasCards, lastEdited }: HomeNextActionInput): HomeNextAction {
  if (dueCount > 0) return { kind: 'review', dueCount }
  if (lastEdited) return { kind: 'resume', path: lastEdited.path, caughtUp: hasCards }
  return null
}
