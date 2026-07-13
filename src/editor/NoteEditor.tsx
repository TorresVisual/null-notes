import { useEditor, EditorContent } from '@tiptap/react'
import { useEffect, useRef } from 'react'
import { coreExtensions } from './extensions'
import { inkApi } from '../lib/ink'
import type { InkData } from '../ink/types'

interface NoteEditorProps {
  content: string
  notePath: string
  onChange: (markdown: string) => void
}

interface MarkdownStorage {
  getMarkdown: () => string
}

function getMarkdown(storage: unknown): string {
  return ((storage as Record<string, unknown>)['markdown'] as MarkdownStorage).getMarkdown()
}

const EMPTY_INK: InkData = { width: 800, height: 400, strokes: [], shapes: [] }

export function NoteEditor({ content, notePath, onChange }: NoteEditorProps) {
  const isProgrammaticUpdate = useRef(false)

  const editor = useEditor({
    extensions: coreExtensions,
    content,
    onUpdate({ editor }) {
      if (isProgrammaticUpdate.current) return
      onChange(getMarkdown(editor.storage))
    },
  })

  useEffect(() => {
    if (!editor) return
    const current = getMarkdown(editor.storage)
    if (content !== current) {
      isProgrammaticUpdate.current = true
      editor.commands.setContent(content)
      isProgrammaticUpdate.current = false
    }
  }, [content, editor])

  useEffect(() => {
    if (!editor) return
    editor.storage.noteContext.notePath = notePath
  }, [editor, notePath])

  async function insertInkBlock() {
    if (!editor) return
    const dir = await inkApi.ensureDir(notePath)
    const sep = dir.includes('\\') ? '\\' : '/'
    const svgPath = `${dir}${sep}sketch-${Date.now()}.svg`
    await inkApi.write(svgPath, EMPTY_INK)
    editor.commands.insertContent({
      type: 'inkBlock',
      attrs: { src: svgPath, width: 800, height: 400 },
    })
  }

  return (
    <div className="note-editor-wrap">
      <div className="editor-toolbar" role="toolbar" aria-label="Insert">
        <button onClick={() => void insertInkBlock()} title="Insert ink block">
          ✏ Ink
        </button>
      </div>
      <EditorContent
        editor={editor}
        role="textbox"
        aria-multiline="true"
        className="note-editor"
      />
    </div>
  )
}
