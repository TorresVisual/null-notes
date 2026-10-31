const DELIMITER = /^---[ \t]*\r?\n?$/

export interface SplitNote {
  frontmatter: string
  body: string
}

// Mirrors `split_frontmatter` in src-tauri/src/commands/notes.rs. The block is
// kept verbatim (delimiters and line endings included) so the editor never
// parses it as Markdown and `frontmatter + body` is always the original text.
export function splitFrontmatter(content: string): SplitNote {
  const lines = content.split(/(?<=\n)/)
  if (!lines[0] || !DELIMITER.test(lines[0])) return { frontmatter: '', body: content }
  let end = lines[0].length
  for (const line of lines.slice(1)) {
    end += line.length
    if (DELIMITER.test(line)) {
      return { frontmatter: content.slice(0, end), body: content.slice(end) }
    }
  }
  return { frontmatter: '', body: content }
}

export function joinFrontmatter(frontmatter: string, body: string): string {
  const separator = frontmatter && body && !frontmatter.endsWith('\n') ? '\n' : ''
  return frontmatter + separator + body
}
