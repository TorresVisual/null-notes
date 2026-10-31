// A saved search is clicked in the sidebar, but the search modal mounts after
// it — this hands the query across, consumed once, same shape as
// pendingHighlight.ts.
let pending: string | null = null

export function setPendingSearch(query: string): void {
  pending = query
}

export function takePendingSearch(): string {
  const query = pending ?? ''
  pending = null
  return query
}
