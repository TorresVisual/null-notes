/**
 * Turning the last numbered `> [!THEOREM 3.2]`-style callout into a
 * `Theorem 3.2 :: <body>` flashcard line, inserted right below the block.
 * Same posture as `addFlashcardForLastTask`: one line inserted, nothing rewritten.
 */

import type { Editor } from '@tiptap/core'
import { markdownOf } from '../editor/splitIntoTasks'

const NUMBERED_CALLOUT = /^>\s*\[!(THEOREM|LEMMA|COROLLARY|DEFINITION|EXAMPLE|ALGORITHM)\s+([\w.]+)\][+-]?/i

export type CalloutFlashcardOutcome =
  | { kind: 'inserted'; markdown: string }
  | { kind: 'no-callout' }
  | { kind: 'empty' }
  | { kind: 'already-exists' }

function titleCase(word: string): string {
  return word[0]!.toUpperCase() + word.slice(1).toLowerCase()
}

export function addFlashcardForLastCallout(markdown: string): CalloutFlashcardOutcome {
  const lines = markdown.split('\n')

  let start = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if (NUMBERED_CALLOUT.test(lines[i]!)) {
      start = i
      break
    }
  }
  if (start === -1) return { kind: 'no-callout' }

  let end = start
  while (end + 1 < lines.length && lines[end + 1]!.startsWith('>')) end++

  const marker = NUMBERED_CALLOUT.exec(lines[start]!)!
  const front = `${titleCase(marker[1]!)} ${marker[2]}`
  const body = [lines[start]!.slice(marker[0].length), ...lines.slice(start + 1, end + 1)]
    .map((l) => l.replace(/^>\s?/, '').trim())
    .filter(Boolean)
    .join(' ')
  if (!body) return { kind: 'empty' }

  const next = lines.slice(end + 1).find((l) => l.trim())
  if (next?.startsWith(`${front} ::`)) return { kind: 'already-exists' }

  const out = [...lines]
  out.splice(end + 1, 0, '', `${front} :: ${body}`)
  return { kind: 'inserted', markdown: out.join('\n') }
}

export function insertFlashcardFromLastCallout(editor: Editor): CalloutFlashcardOutcome['kind'] {
  const outcome = addFlashcardForLastCallout(markdownOf(editor))
  if (outcome.kind === 'inserted') editor.commands.setContent(outcome.markdown)
  return outcome.kind
}
