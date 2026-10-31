import type { Canvas } from './jsonCanvas'

type Element = { id: string }

type Merged<T> = { items: T[] } | { conflicts: string[] }

function stable(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  )
}

function same(a: Element | undefined, b: Element | undefined): boolean {
  return a === undefined || b === undefined ? a === b : stable(a) === stable(b)
}

// A duplicate id (an agent bug) must survive the merge, so the nth repeat gets its own key.
function keyed<T extends Element>(items: readonly T[]): Map<string, T> {
  const seen = new Map<string, number>()
  const out = new Map<string, T>()
  for (const item of items) {
    const n = seen.get(item.id) ?? 0
    seen.set(item.id, n + 1)
    out.set(n === 0 ? item.id : `${item.id}\u0000${n}`, item)
  }
  return out
}

function mergeElements<T extends Element>(base: readonly T[], mine: readonly T[], theirs: readonly T[]): Merged<T> {
  const b = keyed(base)
  const m = keyed(mine)
  const t = keyed(theirs)
  const keys = [...new Set([...m.keys(), ...t.keys()])]
  const items: T[] = []
  const conflicts: string[] = []

  for (const key of keys) {
    const mine = m.get(key)
    const theirs = t.get(key)
    const base = b.get(key)
    let pick: T | undefined
    if (same(mine, theirs)) pick = mine
    else if (same(base, theirs)) pick = mine
    else if (same(base, mine)) pick = theirs
    else {
      conflicts.push((mine ?? theirs)?.id ?? key)
      continue
    }
    if (pick) items.push(pick)
  }
  return conflicts.length > 0 ? { conflicts } : { items }
}

export function mergeCanvas(base: Canvas, mine: Canvas, theirs: Canvas): { merged: Canvas } | { conflicts: string[] } {
  const nodes = mergeElements(base.nodes, mine.nodes, theirs.nodes)
  const edges = mergeElements(base.edges, mine.edges, theirs.edges)
  const conflicts = [
    ...('conflicts' in nodes ? nodes.conflicts : []),
    ...('conflicts' in edges ? edges.conflicts : []),
  ]
  if (conflicts.length > 0 || !('items' in nodes) || !('items' in edges)) return { conflicts }
  return {
    merged: {
      ...theirs,
      ...mine,
      nodes: nodes.items,
      edges: edges.items,
      lastPass: Math.max(mine.lastPass, theirs.lastPass),
    },
  }
}
