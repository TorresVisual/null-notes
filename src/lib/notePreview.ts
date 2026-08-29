/**
 * A short plain-text excerpt of a note's own content, for the wiki-link
 * hover preview ("go to definition" without clicking through). Strips a
 * leading `# Heading` line — the link text already shows the title — and
 * collapses the rest into one line, since this is a quick peek, not a
 * rendered preview.
 */
export function excerptForPreview(content: string, maxChars = 200): string {
  const lines = content.split('\n')
  if (lines[0]?.trimStart().startsWith('# ')) {
    lines.shift()
  }

  const collapsed = lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' ')

  if (collapsed.length <= maxChars) return collapsed
  return `${collapsed.slice(0, maxChars)}…`
}
