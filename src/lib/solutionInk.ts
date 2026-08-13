/**
 * Putting a handwriting canvas under every `### Solution`.
 *
 * This is the point of the exercise-sheet workflow: the solutions are written
 * by hand, so a scaffold that leaves an empty heading under each task has done
 * the easy half and left the part that matters — inserting a canvas six times
 * by hand, once per exercise.
 *
 * The canvas starts one screen tall rather than a full page. `useInkCanvas`
 * grows it by a page whenever a stroke approaches the bottom, so a short
 * solution stays short and a long one still has room; six full-page canvases
 * in one note would otherwise make the sheet unreadable to scroll.
 */

export const SOLUTION_INK_WIDTH = 700
export const SOLUTION_INK_HEIGHT = 400

const SOLUTION_HEADING = /^###\s+Solution\s*$/

/** How many `### Solution` sections `markdown` holds. */
export function countSolutions(markdown: string): number {
  return markdown.split('\n').filter((line) => SOLUTION_HEADING.test(line)).length
}

/**
 * The Markdown for one ink block — the same fenced form `InkBlock` serializes,
 * so a note written this way is indistinguishable from one drawn into by hand.
 */
export function inkFence(src: string): string {
  const attrs = { src, width: SOLUTION_INK_WIDTH, height: SOLUTION_INK_HEIGHT }
  return '```ink\n' + JSON.stringify(attrs) + '\n```'
}

/**
 * `markdown` with one ink canvas under each `### Solution`, taking sources
 * from `srcs` in order.
 *
 * A solution that already holds something is left alone — running the command
 * twice must not bury the work from the first run under a second blank canvas.
 * Sources are consumed only by the solutions that actually get one.
 */
export function withInkUnderSolutions(markdown: string, srcs: string[]): string {
  const lines = markdown.split('\n')
  const out: string[] = []
  let next = 0

  lines.forEach((line, i) => {
    out.push(line)
    if (!SOLUTION_HEADING.test(line)) return
    if (!isEmptySection(lines, i)) return

    const src = srcs[next]
    if (!src) return
    next += 1
    out.push('', inkFence(src))
  })

  return out.join('\n')
}

/** Whether the section opened at `index` runs to the next heading with nothing in it. */
function isEmptySection(lines: string[], index: number): boolean {
  for (let i = index + 1; i < lines.length; i++) {
    const line = lines[i]!
    if (line.startsWith('#')) return true
    if (line.trim() !== '') return false
  }
  return true
}

/** How many canvases `withInkUnderSolutions` would actually place. */
export function emptySolutionCount(markdown: string): number {
  const lines = markdown.split('\n')
  return lines.filter((line, i) => SOLUTION_HEADING.test(line) && isEmptySection(lines, i)).length
}
