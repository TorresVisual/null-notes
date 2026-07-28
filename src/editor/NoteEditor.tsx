import { useEditor, EditorContent } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import { PenLine } from 'lucide-react'
import { coreExtensions } from './extensions'
import { handleEditorKeyDown, handleEditorTextInput } from './extensions/CodeBlockEditor'
import { inkApi } from '../lib/ink'
import type { InkData } from '../ink/types'
import { EditorStatusBar } from './EditorStatusBar'

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

// Sized to the editor pane's content width (800px max-width less 48px padding
// a side) so the right edge is not clipped, and tall enough for a worked
// derivation rather than a couple of lines.
const INK_WIDTH = 700
const INK_HEIGHT = 900

const EMPTY_INK: InkData = { width: INK_WIDTH, height: INK_HEIGHT, strokes: [], shapes: [] }

export function NoteEditor({ content, notePath, onChange }: NoteEditorProps) {
  const isProgrammaticUpdate = useRef(false)
  const [, setEditorVersion] = useState(0)

  const editor = useEditor({
    extensions: coreExtensions,
    content,
    editorProps: {
      handleKeyDown: handleEditorKeyDown,
      handleTextInput: handleEditorTextInput,
    },
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

  useEffect(() => {
    if (!editor) return
    const refreshToolbar = () => setEditorVersion((version) => version + 1)
    editor.on('selectionUpdate', refreshToolbar)

    return () => {
      editor.off('selectionUpdate', refreshToolbar)
    }
  }, [editor])

  async function insertInkBlock() {
    if (!editor) return
    const dir = await inkApi.ensureDir(notePath)
    const sep = dir.includes('\\') ? '\\' : '/'
    const svgPath = `${dir}${sep}sketch-${Date.now()}.svg`
    await inkApi.write(svgPath, EMPTY_INK)
    editor.commands.insertContent({
      type: 'inkBlock',
      attrs: { src: svgPath, width: INK_WIDTH, height: INK_HEIGHT },
    })
  }

  const codeLanguage = editor?.getAttributes('codeBlock')['language']
  const selectedCodeLanguage = typeof codeLanguage === 'string' ? codeLanguage : ''

  return (
    <div className="note-editor-wrap">
      <div className="editor-toolbar" role="toolbar" aria-label="Insert">
        <button onClick={() => void insertInkBlock()} aria-label="Insert ink block" title="Insert ink block">
          <PenLine size={14} /> Ink
        </button>
        {editor?.isActive('codeBlock') && (
          <label className="code-language-control">
            <span>Language</span>
            <select
              aria-label="Code block language"
              value={selectedCodeLanguage}
              onChange={(event) => {
                editor.chain().focus().updateAttributes('codeBlock', { language: event.target.value }).run()
                setEditorVersion((version) => version + 1)
              }}
            >
              <option value="">Plain text</option>
              <option value="arduino">Arduino</option>
              <option value="bash">Bash</option>
              <option value="c">C</option>
              <option value="cpp">C++</option>
              <option value="csharp">C#</option>
              <option value="css">CSS</option>
              <option value="diff">Diff</option>
              <option value="go">Go</option>
              <option value="graphql">GraphQL</option>
              <option value="html">HTML</option>
              <option value="ini">INI</option>
              <option value="java">Java</option>
              <option value="javascript">JavaScript</option>
              <option value="json">JSON</option>
              <option value="kotlin">Kotlin</option>
              <option value="less">Less</option>
              <option value="lua">Lua</option>
              <option value="makefile">Makefile</option>
              <option value="markdown">Markdown</option>
              <option value="objectivec">Objective-C</option>
              <option value="perl">Perl</option>
              <option value="php">PHP</option>
              <option value="python">Python</option>
              <option value="r">R</option>
              <option value="ruby">Ruby</option>
              <option value="rust">Rust</option>
              <option value="scss">SCSS</option>
              <option value="shell">Shell</option>
              <option value="sql">SQL</option>
              <option value="swift">Swift</option>
              <option value="typescript">TypeScript</option>
              <option value="vbnet">Visual Basic .NET</option>
              <option value="wasm">WebAssembly</option>
              <option value="xml">XML</option>
              <option value="yaml">YAML</option>
            </select>
          </label>
        )}
      </div>
      <EditorContent
        editor={editor}
        role="textbox"
        aria-multiline="true"
        className="note-editor"
      />
      {editor && <EditorStatusBar editor={editor} />}
    </div>
  )
}
