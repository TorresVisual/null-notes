import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { coreExtensions } from './index'

let editor: Editor | null = null

function markdownOf(e: Editor): string {
  const storage = e.storage as unknown as { markdown: { getMarkdown: () => string } }
  return storage.markdown.getMarkdown()
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

// The real converted head of Analysis_2_Blatt12.pdf, verbatim from
// `dump_markdown`. This is the shape the splitter actually receives, and the
// reason "Split Into Tasks" silently did nothing on a real sheet: the earlier
// corpus measurement went through the Rust pipeline only and never through the
// editor, which is where the numbering changes.
const CONVERTED = [
  '# Analysis 2 für Informatikstudien',
  '',
  '12. Übungsblatt',
  '',
  '1. Lösen Sie das folgende Anfangswertproblem mithilfe der Laplace-Transformation:',
  '',
  '2. Lösen Sie das folgende Anfangswertproblem mithilfe der Laplace-Transformation:',
  '',
  '3. Ein gedämpftes Schwingungssystem wird zum Zeitpunkt getroffen:',
].join('\n')

describe('what the editor hands the splitter', () => {
  // Documents the mechanism rather than asserting it is desirable: `12.` and
  // the `1.` under it are one CommonMark list, so the first exercise comes
  // back renumbered. Saving the note writes that back to the file, so it is
  // not recoverable by reading from disk either.
  it('renumbers the first exercise, because it continues the sheet-number list', () => {
    editor = new Editor({ element: document.createElement('div'), extensions: coreExtensions, content: CONVERTED })

    const out = markdownOf(editor)

    expect(out).toContain('12. Übungsblatt')
    expect(out).toContain('13. Lösen Sie')
    expect(out).not.toContain('1. Lösen Sie das folgende Anfangswertproblem mithilfe der Laplace-Transformation:\n')
  })

  // Which is why the splitter may not require a run starting at 1. This is the
  // regression guard for the reported bug: the numbers below are what the
  // editor really produces, and they must still split.
  it('still yields numbers the splitter can work from', () => {
    editor = new Editor({ element: document.createElement('div'), extensions: coreExtensions, content: CONVERTED })

    const numbers = markdownOf(editor)
      .split('\n')
      .map((line) => /^(\d+)\.\s+\S/.exec(line)?.[1])
      .filter((n): n is string => n !== undefined)

    // Every exercise continues the sheet-number list, so none of the original
    // numbers survives. A block between two items (an equation, say) breaks
    // the list and the next one restarts — which is why a real sheet shows a
    // mixture like 12, 13, 2, 3, 4 rather than a clean sequence.
    expect(numbers).toEqual(['12', '13', '14', '15'])
  })
})
