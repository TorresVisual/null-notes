import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { coreExtensions } from './index'
import { nextTaskLabel } from '../../lib/taskScaffold'

let editor: Editor | null = null

function mount(content: string): Editor {
  editor = new Editor({ element: document.createElement('div'), extensions: coreExtensions, content })
  return editor
}

function markdownOf(e: Editor): string {
  const storage = e.storage as unknown as { markdown: { getMarkdown: () => string } }
  return storage.markdown.getMarkdown()
}

/** What the slash command does, minus the suggestion range it deletes. */
function addNextTask(e: Editor): void {
  const label = nextTaskLabel(markdownOf(e))
  e.chain()
    .insertContentAt(e.state.doc.content.size, [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: `Task ${label}` }] },
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Solution' }] },
      { type: 'paragraph' },
    ])
    .run()
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

// The scaffold the importer writes and the one this command appends have to be
// the same shape, or the count drifts the first time you use it on a converted
// sheet. Serializing and re-reading is the only check that proves it.
describe('add next task', () => {
  it('appends the pair the importer would have written', () => {
    const e = mount('## Task 1\n\n### Solution\n\nmy working\n')

    addNextTask(e)

    expect(markdownOf(e)).toContain('## Task 2\n\n### Solution')
  })

  it('keeps counting across repeated use', () => {
    const e = mount('## Task 1\n\n### Solution\n')

    addNextTask(e)
    addNextTask(e)
    addNextTask(e)

    const md = markdownOf(e)
    expect(md).toContain('## Task 4')
    expect(md.match(/^## Task /gm)).toHaveLength(4)
  })

  it('starts at 1 in a note that has no tasks', () => {
    const e = mount('# Lecture 7\n\nordinary prose\n')

    addNextTask(e)

    expect(markdownOf(e)).toContain('## Task 1')
  })

  it('continues a dotted sheet at its own numbering', () => {
    const e = mount('## Task 9.5\n\n### Solution\n')

    addNextTask(e)

    expect(markdownOf(e)).toContain('## Task 9.6')
  })

  it('leaves the existing content alone', () => {
    const e = mount('## Task 1\n\n### Solution\n\nmy working\n')

    addNextTask(e)

    expect(markdownOf(e)).toContain('my working')
  })
})
