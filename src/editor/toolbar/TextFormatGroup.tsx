import { Bold, Italic, List, ListOrdered } from 'lucide-react'
import { useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/core'

interface TextFormatGroupProps {
  editor: Editor
}

const HEADINGS = [1, 2, 3] as const

// Subscribed directly to the editor's own `transaction` event, not to a
// re-render forced by the parent: toggling a mark or block type leaves the
// selection's `from`/`to` unchanged, so `selectionUpdate` — what NoteEditor
// re-renders on — never fires. Without this, a button's pressed state only
// caught up once the caret next moved.
export function TextFormatGroup({ editor }: TextFormatGroupProps) {
  const active = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      heading: Object.fromEntries(
        HEADINGS.map((level) => [level, editor.isActive('heading', { level })]),
      ) as Record<(typeof HEADINGS)[number], boolean>,
      bulletList: editor.isActive('bulletList'),
      orderedList: editor.isActive('orderedList'),
    }),
  })

  return (
    <div className="toolbar-group" role="group" aria-label="Formatting">
      <button
        className={`toolbar-button${active.bold ? ' active' : ''}`}
        aria-pressed={active.bold}
        aria-label="Bold"
        title="Bold"
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold size={15} />
      </button>
      <button
        className={`toolbar-button${active.italic ? ' active' : ''}`}
        aria-pressed={active.italic}
        aria-label="Italic"
        title="Italic"
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic size={15} />
      </button>
      <span className="toolbar-sep" aria-hidden />
      {HEADINGS.map((level) => (
        <button
          key={level}
          className={`toolbar-button${active.heading[level] ? ' active' : ''}`}
          aria-pressed={active.heading[level]}
          aria-label={`Heading ${level}`}
          title={`Heading ${level}`}
          onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
        >
          H{level}
        </button>
      ))}
      <span className="toolbar-sep" aria-hidden />
      <button
        className={`toolbar-button${active.bulletList ? ' active' : ''}`}
        aria-pressed={active.bulletList}
        aria-label="Bullet list"
        title="Bullet list"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List size={15} />
      </button>
      <button
        className={`toolbar-button${active.orderedList ? ' active' : ''}`}
        aria-pressed={active.orderedList}
        aria-label="Numbered list"
        title="Numbered list"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered size={15} />
      </button>
    </div>
  )
}
