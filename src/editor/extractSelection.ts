import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { message } from '@tauri-apps/plugin-dialog'
import { api } from '../lib/tauri'
import { queueGitPaths } from '../lib/noteActions'
import { refreshTree } from '../hooks/useWorkspace'
import { promptText } from '../store/promptDialog'
import { showToast } from '../store/toast'
import { markdownOf } from './splitIntoTasks'

interface MarkdownStorage {
  markdown: { serializer: { serialize: (doc: ProseMirrorNode) => string } }
}

// Whole top-level blocks, so a selection that starts or ends mid-paragraph
// moves that paragraph intact rather than splitting it.
function blockRange(editor: Editor): { from: number; to: number; heading: string } | null {
  const { from, to } = editor.state.selection
  let range: { from: number; to: number; heading: string } | null = null
  editor.state.doc.forEach((node, offset) => {
    const end = offset + node.nodeSize
    if (end <= from || offset >= to) return
    range = {
      from: range?.from ?? offset,
      to: end,
      heading: range?.heading ?? (node.type.name === 'heading' ? node.textContent : ''),
    }
  })
  return range
}

export async function extractSelection(editor: Editor, notePath: string, workspace: string): Promise<void> {
  const range = blockRange(editor)
  if (!range || editor.state.selection.empty) {
    await message('Select the blocks to extract first.')
    return
  }
  const title = (await promptText('Title of the new note:', range.heading))?.trim()
  if (!title) return

  const { serializer } = (editor.storage as unknown as MarkdownStorage).markdown
  const markdown = serializer.serialize(editor.state.doc.cut(range.from, range.to))
  const created = await api.notes.extract(workspace, notePath, title, markdown)

  const before = markdownOf(editor)
  editor
    .chain()
    .focus()
    .insertContentAt(
      { from: range.from, to: range.to },
      [{ type: 'paragraph', content: [{ type: 'wikiLink', attrs: { title: created.title } }] }],
    )
    .run()
  const after = markdownOf(editor)

  queueGitPaths(created.path)
  await refreshTree()
  showToast(`Extracted to "${created.title}"`, {
    label: 'Undo',
    onClick: () => {
      // Only while the note is exactly as the extract left it; after any
      // further edit, undo would unwind the wrong thing.
      if (markdownOf(editor) !== after || after === before) return
      editor.commands.undo()
      api.notes
        .delete(workspace, created.path)
        .then(() => refreshTree())
        .catch((err) => showToast(err instanceof Error ? err.message : String(err)))
    },
  })
}
