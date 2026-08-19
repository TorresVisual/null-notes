// P6-6's outline panel. Parses headings from the note's own markdown text
// rather than the live ProseMirror DOM — see the postmortem in
// docs/ROADMAP.md: observing the editor's contentEditable with a
// MutationObserver fed back into ProseMirror's own internal DOM housekeeping
// (a trailing-<br> placeholder it adds and removes for cursor placement) and
// froze the app. The note's content is already available on every keystroke
// (useNote's `content` state), so there is no need to touch the DOM at all
// for the list itself.

export interface OutlineHeading {
  level: number
  text: string
}

// A heading-shaped line inside a fenced code block is code, not structure —
// the same judgement notes.rs's own extract_tags makes for #tags.
function stripFencedCode(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, '')
}

const HEADING_LINE = /^(#{1,6})\s+(.+)$/gm

export function parseHeadings(markdown: string): OutlineHeading[] {
  const stripped = stripFencedCode(markdown)
  const headings: OutlineHeading[] = []
  for (const match of stripped.matchAll(HEADING_LINE)) {
    const hashes = match[1]
    const text = match[2]
    if (!hashes || !text) continue
    headings.push({ level: hashes.length, text: text.trim() })
  }
  return headings
}
