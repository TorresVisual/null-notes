import type { Editor } from '@tiptap/core'
import { message as showMessage } from '@tauri-apps/plugin-dialog'
import { api } from '../lib/tauri'
import { inkApi } from '../lib/ink'
import {
  emptySolutionCount,
  withInkUnderSolutions,
  SOLUTION_INK_WIDTH,
  SOLUTION_INK_HEIGHT,
} from '../lib/solutionInk'
import type { InkData } from '../ink/types'

export type SplitOutcome = 'split' | 'no-structure'

/**
 * Reports a failed command instead of letting it vanish.
 *
 * Both entry points used to fire this work as a bare `void promise.then(…)`,
 * so anything that rejected — a backend that has not been rebuilt and so does
 * not carry the command at all, a sidecar that could not be written — did
 * nothing whatsoever: no message, no change, no clue. The same rule the save
 * path has had since P0-2 applies here; a command that fails has to say so.
 */
export function report(error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error)
  // Logged as well as shown: if the dialog itself is what is not getting
  // through, the console still has it.
  console.error('[split-into-tasks]', error)
  void showMessage(`Split Into Tasks failed: ${detail}`)
}

function emptyInk(): InkData {
  return { originX: 0, originY: 0, width: SOLUTION_INK_WIDTH, height: SOLUTION_INK_HEIGHT, strokes: [], shapes: [], texts: [] }
}

export function markdownOf(editor: Editor): string {
  const storage = editor.storage as unknown as { markdown: { getMarkdown: () => string } }
  return storage.markdown.getMarkdown()
}

export function notePathOf(editor: Editor): string {
  const storage = editor.storage as unknown as { noteContext?: { notePath?: string } }
  const notePath = storage.noteContext?.notePath
  // The sibling Ink Block command carries the same guard, silently. An ink
  // block is a reference to a file beside the note, so without the note's own
  // path there is nowhere to put one — and failing with that sentence beats
  // failing with "cannot read property of undefined".
  if (!notePath) throw new Error('this note has no path yet, so no ink canvas can be created')
  return notePath
}

/**
 * Creates `count` blank ink sidecars for this note and returns their paths.
 *
 * One file per canvas, because that is what an ink block is — a reference to
 * an SVG beside the note. They are created before the document is rewritten so
 * a failure leaves the note untouched rather than holding blocks that point at
 * files which were never written.
 */
async function blankCanvases(notePath: string, count: number): Promise<string[]> {
  // Checked before touching the filesystem: creating the sidecar for zero
  // canvases leaves an empty `NoteName.ink/` next to a note that has no ink in
  // it, which reads as the command having half-run.
  if (count === 0) return []

  const dir = await inkApi.ensureDir(notePath)
  const sep = dir.includes('\\') ? '\\' : '/'
  const stamp = Date.now()

  const paths: string[] = []
  for (let i = 0; i < count; i++) {
    const path = `${dir}${sep}solution-${stamp}-${i + 1}.svg`
    await inkApi.write(path, emptyInk())
    paths.push(path)
  }
  return paths
}

/**
 * Rewrites the open note into `## Task N` / `### Solution` pairs, each solution
 * holding a blank handwriting canvas.
 *
 * The canvas is the point of the whole workflow — solutions are written by
 * hand, and a scaffold of empty headings leaves you inserting ink once per
 * exercise. A solution that already holds something keeps it.
 *
 * Never runs on its own: a PDF import produces plain Markdown, because
 * asserting a document *is* an exercise sheet is a claim only the reader can
 * make.
 */
export async function splitIntoTasks(editor: Editor): Promise<SplitOutcome> {
  const before = markdownOf(editor)
  const split = await api.notes.splitIntoTasks(before)
  if (split === before) return 'no-structure'

  // The split is the deliverable; the canvases are an addition to it. Losing
  // the whole rewrite because a sidecar could not be written is the wrong
  // trade — and it is what "it worked before ink support" was describing.
  // A canvas failure is reported and the note is split anyway.
  let srcs: string[] = []
  try {
    srcs = await blankCanvases(notePathOf(editor), emptySolutionCount(split))
  } catch (error) {
    report(error)
  }

  editor.commands.setContent(withInkUnderSolutions(split, srcs))
  return 'split'
}

/**
 * Appends the next `## Task N` / `### Solution` pair, with its own blank
 * canvas — the same shape `splitIntoTasks` produces, so the sheet stays
 * consistent however it grew.
 */
export async function addNextTask(editor: Editor, label: string): Promise<void> {
  const [src] = await blankCanvases(notePathOf(editor), 1)

  editor
    .chain()
    .insertContentAt(editor.state.doc.content.size, [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: `Task ${label}` }] },
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Solution' }] },
      ...(src
        ? [{ type: 'inkBlock', attrs: { src, width: SOLUTION_INK_WIDTH, height: SOLUTION_INK_HEIGHT } }]
        : []),
      { type: 'paragraph' },
    ])
    .run()
}
