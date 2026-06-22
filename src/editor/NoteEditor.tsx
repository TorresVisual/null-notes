import { useEditor, EditorContent } from '@tiptap/react'
import { useEffect } from 'react'
import { coreExtensions } from './extensions'

interface NoteEditorProps {
  content: string
  onChange: (markdown: string) => void
}

interface MarkdownStorage {
  getMarkdown: () => string
}

function getMarkdown(storage: unknown): string {
  return ((storage as Record<string, unknown>)['markdown'] as MarkdownStorage).getMarkdown()
}

export function NoteEditor({ content, onChange }: NoteEditorProps) {
  const editor = useEditor({
    extensions: coreExtensions,
    content,
    onUpdate({ editor }) {
      onChange(getMarkdown(editor.storage))
    },
  })

  useEffect(() => {
    if (!editor) return
    const current = getMarkdown(editor.storage)
    if (content !== current) {
      editor.commands.setContent(content)
    }
  }, [content, editor])

  return (
    <EditorContent
      editor={editor}
      role="textbox"
      aria-multiline="true"
      className="note-editor"
    />
  )
}
