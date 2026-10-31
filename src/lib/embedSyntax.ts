import { parseWikiLink } from './wikiLinkSyntax'
import type { WikiLinkParts } from './wikiLinkSyntax'

const EMBED_PARAGRAPH = /^!\[\[([^\]\n]+)\]\]$/
const HEADING_LINE = /^(#{1,6})\s+(.+)$/

export function parseEmbedParagraph(content: string): WikiLinkParts | null {
  const match = EMBED_PARAGRAPH.exec(content.trim())
  return match?.[1] ? parseWikiLink(match[1]) : null
}

// Walks lines rather than reusing parseHeadings: that one strips fenced code
// before matching, which would shift every offset this needs to slice on.
export function sectionOf(markdown: string, heading: string): string | null {
  const wanted = heading.trim().toLowerCase()
  const lines = markdown.split(/\r?\n/)
  let inFence = false
  let start = -1
  let level = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (line.startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = HEADING_LINE.exec(line)
    if (!match) continue
    const depth = match[1]?.length ?? 0
    if (start < 0) {
      if ((match[2] ?? '').trim().toLowerCase() === wanted) {
        start = i
        level = depth
      }
    } else if (depth <= level) {
      return lines.slice(start, i).join('\n')
    }
  }
  return start < 0 ? null : lines.slice(start).join('\n')
}

export function embedBody(markdown: string, heading: string): string | null {
  if (heading) return sectionOf(markdown, heading)
  const lines = markdown.split(/\r?\n/)
  if (lines[0]?.startsWith('# ')) lines.shift()
  return lines.join('\n')
}
