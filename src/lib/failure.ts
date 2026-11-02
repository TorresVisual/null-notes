export function failure(action: string, e: unknown): string {
  return `Couldn't ${action}: ${e instanceof Error ? e.message : String(e)}`
}
