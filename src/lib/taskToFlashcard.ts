/**
 * Turning a worked `## Task N` / `### Solution` pair into a Q&A flashcard.
 *
 * Reuses the existing card system as-is: a card is one `Front :: Back` line
 * (`extract_cards`, notes.rs), and `CardText` already renders an inline
 * `![alt](src)` on either side as an image. The only new work is building
 * that line — front from the task's problem text, back from a Markdown
 * image pointing at the Solution's ink drawing.
 *
 * Always targets the *last* Task in the note, matching `addNextTask`'s own
 * "operate on the end" scope — the workflow is "just finished handwriting
 * this solution, make it a card," not picking an arbitrary earlier one.
 */

import type { Editor } from '@tiptap/core'
import { TASK_HEADING_LINE } from './taskScaffold'
import { decodeSrc, encodeSrc } from '../editor/extensions/NoteImage'
import { markdownOf, notePathOf } from '../editor/splitIntoTasks'

const SOLUTION_HEADING_LINE = /^###\s+Solution\s*$/
const INK_IMAGE_LINE = /^!\[[^\]]*\]\(([^)#]*\.ink\/[^)#]*)#ink=[^)]*\)$/
const CARD_LINE =/\s::\s.*!\[[^\]]*\]\([^)]+\)/

export type FlashcardOutcome =
  | { kind: 'inserted'; markdown: string }
  | { kind: 'no-task' }
  | { kind: 'no-solution' }
  | { kind: 'no-drawing' }
  | { kind: 'already-exists' }

/** The ink sidecar's own relative path, matching `ink_dir_for` in ink.rs:
 *  `{note stem}.ink/{file}` — the form `resolve_relative` (assets.rs) accepts,
 *  unlike the absolute path an ink block's `src` attribute actually holds. */
function relativeInkPath(notePath: string, absoluteInkSrc: string): string {
  const stem = notePath.replace(/\\/g, '/').split('/').pop()!.replace(/\.md$/, '')
  const file = absoluteInkSrc.replace(/\\/g, '/').split('/').pop()!
  return `${stem}.ink/${file}`
}

/** Adds a flashcard for the last Task/Solution pair in `markdown`. */
export function addFlashcardForLastTask(markdown: string, notePath: string): FlashcardOutcome {
  const lines = markdown.split('\n')

  let taskLine = -1
  let label = ''
  lines.forEach((line, i) => {
    const match = TASK_HEADING_LINE.exec(line)
    if (match) {
      taskLine = i
      label = match[1]!
    }
  })
  if (taskLine === -1) return { kind: 'no-task' }

  let sectionEnd = lines.length
  for (let i = taskLine + 1; i < lines.length; i++) {
    if (TASK_HEADING_LINE.test(lines[i]!)) {
      sectionEnd = i
      break
    }
  }

  let solutionLine = -1
  for (let i = taskLine + 1; i < sectionEnd; i++) {
    if (SOLUTION_HEADING_LINE.test(lines[i]!)) {
      solutionLine = i
      break
    }
  }
  if (solutionLine === -1) return { kind: 'no-solution' }

  const front = lines
    .slice(taskLine + 1, solutionLine)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ')
  if (!front) return { kind: 'no-solution' }

  for (let i = solutionLine + 1; i < sectionEnd; i++) {
    if (CARD_LINE.test(lines[i]!)) return { kind: 'already-exists' }
  }

  let inkSrc: string | null = null
  let fenceEnd = solutionLine
  for (let i = solutionLine + 1; i < sectionEnd; i++) {
    const image = INK_IMAGE_LINE.exec(lines[i]!.trim())
    if (image) {
      inkSrc = decodeSrc(image[1]!)
      fenceEnd = i
      break
    }
    if (lines[i]!.trim() !== '```ink') continue
    let close = -1
    for (let j = i + 1; j < sectionEnd; j++) {
      if (lines[j]!.trim() === '```') {
        close = j
        break
      }
    }
    if (close === -1) break
    try {
      const attrs = JSON.parse(lines.slice(i + 1, close).join('\n')) as { src?: string }
      if (attrs.src) {
        inkSrc = attrs.src
        fenceEnd = close
      }
    } catch {
      // invalid JSON in the fence — treat as no drawing
    }
    break
  }
  if (!inkSrc) return { kind: 'no-drawing' }

  const back = `![Task ${label} solution](${encodeSrc(relativeInkPath(notePath, inkSrc))})`
  const cardLine = `${front} :: ${back}`

  const out = [...lines]
  out.splice(fenceEnd + 1, 0, '', cardLine)
  return { kind: 'inserted', markdown: out.join('\n') }
}

/** Editor-facing wrapper: rewrites the open note in place, returning why not
 *  when there was nothing to insert. */
export function insertFlashcardFromLastTask(editor: Editor): FlashcardOutcome['kind'] {
  const outcome = addFlashcardForLastTask(markdownOf(editor), notePathOf(editor))
  if (outcome.kind === 'inserted') editor.commands.setContent(outcome.markdown)
  return outcome.kind
}
