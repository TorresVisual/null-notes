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
