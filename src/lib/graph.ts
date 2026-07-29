import type { NoteMetadata, GraphLink, GraphTag } from '../types'

export interface GraphNode {
  id: string
  title: string
}

export interface GraphEdge {
  source: string
  target: string
  kind: 'link' | 'tag'
}

// Resolves raw link/tag rows from the backend into a deduplicated node/edge
// graph. Link resolution matches how [[links]] resolve elsewhere in the app
// (backlinks_for, WikiLink): case-insensitive title match, unresolved links
// dropped rather than shown as dangling nodes. Notes sharing a tag get a
// pairwise edge between every pair — fine at personal-notebook tag sizes,
// but a tag shared by very many notes would generate a lot of edges.
export function buildGraph(
  notes: NoteMetadata[],
  links: GraphLink[],
  tags: GraphTag[],
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = notes.map((n) => ({ id: n.path, title: n.title }))
  const titleToPath = new Map(notes.map((n) => [n.title.toLowerCase(), n.path]))

  const seen = new Set<string>()
  const edges: GraphEdge[] = []

  function addEdge(a: string, b: string, kind: 'link' | 'tag') {
    if (a === b) return
    const key = `${kind}:${[a, b].sort().join('|')}`
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ source: a, target: b, kind })
  }

  for (const link of links) {
    const targetPath = titleToPath.get(link.targetTitle.toLowerCase())
    if (targetPath) addEdge(link.sourcePath, targetPath, 'link')
  }

  const notesByTag = new Map<string, string[]>()
  for (const t of tags) {
    const key = t.tag.toLowerCase()
    const list = notesByTag.get(key)
    if (list) list.push(t.notePath)
    else notesByTag.set(key, [t.notePath])
  }
  for (const paths of notesByTag.values()) {
    for (let i = 0; i < paths.length; i++) {
      for (let j = i + 1; j < paths.length; j++) {
        addEdge(paths[i]!, paths[j]!, 'tag')
      }
    }
  }

  return { nodes, edges }
}
