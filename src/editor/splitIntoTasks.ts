import type { Editor } from '@tiptap/core'
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

function emptyInk(): InkData {
  return { width: SOLUTION_INK_WIDTH, height: SOLUTION_INK_HEIGHT, strokes: [], shapes: [] }
}

function markdownOf(editor: Editor): string {
  const storage = editor.storage as unknown as { markdown: { getMarkdown: () => string } }
  return storage.markdown.getMarkdown()
}

function notePathOf(editor: Editor): string {
  const storage = editor.storage as unknown as { noteContext: { notePath: string } }
  return storage.noteContext.notePath
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

  const srcs = await blankCanvases(notePathOf(editor), emptySolutionCount(split))
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
