/**
 * Recognising a code path written in a note: `src/main.cpp:58`,
 * `path/file.rs#L20-L30`.
 *
 * Deliberately narrow. Without both a separator and a file extension,
 * `Analysis 2:` in prose, a `10:30` timestamp and a bare `README` all become
 * links — and a wrong link that launches an editor is worse than no link.
 * Same judgement as the PDF pipeline's exercise patterns: prefer a miss.
 *
 * Design: `docs/specs/code-deep-links-design.md`.
 */

export interface CodeLink {
  /** The workspace-relative path, without any line suffix. */
  target: string
  /** The line to open at, or null when the link named no line. */
  line: number | null
  /** Offsets of the whole match in the text it was found in. */
  from: number
  to: number
}

// A path with at least one `/`, a final segment carrying a 1–8 char extension,
// then optionally `:58`, `#L58` or `#L20-L30`. Segments allow the characters a
// real source path uses and nothing else — no spaces, so a sentence can never
// be swallowed into a match.
const PATTERN =
  /(?:[\w.@+-]+\/)+[\w.@+-]+\.[A-Za-z0-9]{1,8}(?::(\d+)(?::\d+)?|#L(\d+)(?:-L?\d+)?)?/g

export function findCodeLinks(text: string): CodeLink[] {
  const found: CodeLink[] = []
  for (const match of text.matchAll(PATTERN)) {
    const whole = match[0]
    const index = match.index ?? 0
    const line = match[1] ?? match[2]

    found.push({
      target: stripSuffix(whole),
      line: line ? Number(line) : null,
      from: index,
      to: index + whole.length,
    })
  }
  return found
}

/** The path alone: everything before the `:58` or `#L58` a match may carry. */
function stripSuffix(match: string): string {
  const hash = match.indexOf('#')
  if (hash !== -1) return match.slice(0, hash)
  // A colon only ends the path when digits follow it — a Windows drive letter
  // never reaches here (the pattern requires a `/` before the final segment),
  // but a filename may legitimately contain one.
  const colon = match.search(/:\d+/)
  return colon === -1 ? match : match.slice(0, colon)
}

// A line-comment marker in one of the languages this app's syntax highlighter
// actually covers, followed by the space a human types after one. Stripped
// before matching so `// src/main.rs` and `# scripts/build.py` both read as
// the bare path underneath — the same shape a plain `src/main.rs` line does.
const COMMENT_PREFIX = /^[ \t]*(?:\/\/|#|--|;|%)[ \t]*/

/**
 * The source path a code block's first line names, or null.
 *
 * A code block "carrying a source path" (P7-2) means its first line *is*
 * that path, comment marker optional — `// src/main.rs` above a pasted
 * function is already how this gets written by hand. Deliberately reuses
 * `findCodeLinks` rather than a second pattern: a path mid-sentence
 * ("see src/main.rs for details") is prose, not an annotation, so the whole
 * stripped line has to be nothing but the match.
 */
export function codeBlockSourcePath(firstLine: string): CodeLink | null {
  const stripped = firstLine.replace(COMMENT_PREFIX, '').trim()
  if (!stripped) return null

  const [link, second] = findCodeLinks(stripped)
  if (!link || second) return null
  if (stripped.slice(link.from, link.to) !== stripped) return null

  return link
}
