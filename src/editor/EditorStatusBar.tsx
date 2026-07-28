import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/core'

interface EditorStatusBarProps {
  editor: Editor
}

interface EditorStatus {
  block: string
  column: number
  line: number
  words: number
}

function describeBlock(editor: Editor): string {
  const node = editor.state.selection.$from.parent

  if (node.type.name === 'heading') {
    const level = node.attrs['level']
    return typeof level === 'number' ? `Heading ${level}` : 'Heading'
  }

  if (node.type.name === 'codeBlock') {
    const language = node.attrs['language']
    return typeof language === 'string' && language ? `Code · ${language}` : 'Code'
  }

  const labels: Record<string, string> = {
    blockquote: 'Quote',
    bulletList: 'Bullet list',
    listItem: 'List item',
    orderedList: 'Numbered list',
    paragraph: 'Paragraph',
    taskItem: 'Task',
  }

  return labels[node.type.name] ?? 'Block'
}

function getEditorStatus(editor: Editor): EditorStatus {
  const { from } = editor.state.selection
  const textBeforeCursor = editor.state.doc.textBetween(0, from, '\n', '\n')
  const lines = textBeforeCursor.split('\n')
  const lastLine = lines.at(-1) ?? ''
  const content = editor.state.doc.textContent.trim()

  return {
    block: describeBlock(editor),
    column: lastLine.length + 1,
    line: lines.length,
    words: content ? content.split(/\s+/).length : 0,
  }
}

export function EditorStatusBar({ editor }: EditorStatusBarProps) {
  const [status, setStatus] = useState(() => getEditorStatus(editor))

  useEffect(() => {
    const refresh = () => setStatus(getEditorStatus(editor))
    editor.on('transaction', refresh)
    editor.on('selectionUpdate', refresh)

    return () => {
      editor.off('transaction', refresh)
      editor.off('selectionUpdate', refresh)
    }
  }, [editor])

  return (
    <div className="editor-status" aria-label="Editor status">
      <span>{status.block}</span>
      <span>Ln {status.line}, Col {status.column}</span>
      <span>{status.words} {status.words === 1 ? 'word' : 'words'}</span>
    </div>
  )
}
