import { SplitSquareVertical, Plus } from 'lucide-react'
import type { Editor } from '@tiptap/core'
import { message } from '@tauri-apps/plugin-dialog'
import { splitIntoTasks, addNextTask, report } from '../splitIntoTasks'
import { nextTaskLabel } from '../../lib/taskScaffold'

interface SheetGroupProps {
  editor: Editor
}

function markdownOf(editor: Editor): string {
  const storage = editor.storage as unknown as { markdown: { getMarkdown: () => string } }
  return storage.markdown.getMarkdown()
}

export function SheetGroup({ editor }: SheetGroupProps) {
  return (
    <div className="toolbar-group" role="group" aria-label="Exercise sheet">
      <button
        className="toolbar-button"
        aria-label="Split into tasks"
        title="Rewrite this note as Task / Solution sections with a canvas each"
        onClick={() => {
          void splitIntoTasks(editor)
            .then((outcome) => {
              if (outcome === 'no-structure') {
                void message('No exercise structure found in this note — nothing was changed.')
              }
            })
            .catch(report)
        }}
      >
        <SplitSquareVertical size={15} />
      </button>
      <button
        className="toolbar-button"
        aria-label="Add next task"
        title="Append the next numbered Task and Solution pair"
        onClick={() => {
          void addNextTask(editor, nextTaskLabel(markdownOf(editor))).catch(report)
        }}
      >
        <Plus size={15} />
      </button>
    </div>
  )
}
