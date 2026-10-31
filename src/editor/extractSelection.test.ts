import { describe, it, expect, afterEach, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { extensionsFor } from './extensions/index'
import { extractSelection } from './extractSelection'

const extract = vi.fn()
vi.mock('../lib/tauri', () => ({ api: { notes: { extract: (...a: unknown[]) => extract(...a), delete: vi.fn() } } }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ message: vi.fn() }))
vi.mock('../lib/noteActions', () => ({ queueGitPaths: vi.fn() }))
vi.mock('../hooks/useWorkspace', () => ({ refreshTree: vi.fn() }))
vi.mock('../store/toast', () => ({ showToast: vi.fn() }))
vi.mock('../store/promptDialog', () => ({ promptText: vi.fn(async () => 'Part Two') }))

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

function markdownOf(e: Editor): string {
  return (e.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown()
}

describe('extractSelection', () => {
  it('moves whole selected blocks, sidecar links included, and leaves a wiki-link', async () => {
    extract.mockResolvedValue({ title: 'Part Two', path: '/ws/Part Two.md' })
    editor = new Editor({
      element: document.createElement('div'),
      extensions: extensionsFor('/ws/Lecture 7.md'),
      content: '# Lecture 7\n\nkeep me\n\nmove me\n\n![fig](Lecture%207.assets/a.png)\n\nand me',
    })
    const doc = editor.state.doc
    const from = doc.resolve(doc.child(0).nodeSize + doc.child(1).nodeSize + 3)
    const to = doc.resolve(doc.content.size - 3)
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.between(from, to)))

    await extractSelection(editor, '/ws/Lecture 7.md', '/ws')

    const [, source, title, moved] = extract.mock.calls[0] as string[]
    expect(source).toBe('/ws/Lecture 7.md')
    expect(title).toBe('Part Two')
    expect(moved).toContain('move me')
    expect(moved).toContain('Lecture%207.assets/a.png')
    expect(moved).toContain('and me')
    expect(moved).not.toContain('keep me')
    const left = markdownOf(editor)
    expect(left).toContain('keep me')
    expect(left).toContain('[[Part Two]]')
    expect(left).not.toContain('move me')
  })
})
