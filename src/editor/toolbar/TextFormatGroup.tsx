import { Bold, Italic, List, ListOrdered } from 'lucide-react'
import type { Editor } from '@tiptap/core'

interface TextFormatGroupProps {
  editor: Editor
}

const HEADINGS = [1, 2, 3] as const

export function TextFormatGroup({ editor }: TextFormatGroupProps) {
  return (
    <div className="toolbar-group" role="group" aria-label="Formatting">
      <button
        className={`toolbar-button${editor.isActive('bold') ? ' active' : ''}`}
        aria-pressed={editor.isActive('bold')}
        aria-label="Bold"
        title="Bold"
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold size={15} />
      </button>
      <button
        className={`toolbar-button${editor.isActive('italic') ? ' active' : ''}`}
        aria-pressed={editor.isActive('italic')}
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
          className={`toolbar-button${editor.isActive('heading', { level }) ? ' active' : ''}`}
          aria-pressed={editor.isActive('heading', { level })}
          aria-label={`Heading ${level}`}
          title={`Heading ${level}`}
          onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
        >
          H{level}
        </button>
      ))}
      <span className="toolbar-sep" aria-hidden />
      <button
        className={`toolbar-button${editor.isActive('bulletList') ? ' active' : ''}`}
        aria-pressed={editor.isActive('bulletList')}
        aria-label="Bullet list"
        title="Bullet list"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List size={15} />
      </button>
      <button
        className={`toolbar-button${editor.isActive('orderedList') ? ' active' : ''}`}
        aria-pressed={editor.isActive('orderedList')}
        aria-label="Numbered list"
        title="Numbered list"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered size={15} />
      </button>
    </div>
  )
}
