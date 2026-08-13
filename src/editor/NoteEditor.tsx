import { useEditor, EditorContent } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import { PenLine } from 'lucide-react'
import { TextSelection } from '@tiptap/pm/state'
import { coreExtensions } from './extensions'
import { rememberPosition, recallPosition } from '../lib/notePositions'
import { handleEditorKeyDown, handleEditorTextInput } from './extensions/CodeBlockEditor'
import { inkApi } from '../lib/ink'
import { splitIntoTasks } from './splitIntoTasks'
import type { InkData } from '../ink/types'
import { EditorStatusBar } from './EditorStatusBar'
import { BlockHandle } from './extensions/BlockHandle'

interface NoteEditorProps {
  content: string
  notePath: string
  spellcheck: boolean
  spellcheckLanguage: string
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

// `lang` is the only thing that tells the WebView which dictionary to check
// against; without it the note inherits index.html's `lang="en"`, and German
// prose comes back underlined word for word.
function buildEditorProps(spellcheck: boolean, language: string) {
  return {
    attributes: { spellcheck: String(spellcheck), lang: language },
    handleKeyDown: handleEditorKeyDown,
    handleTextInput: handleEditorTextInput,
  }
}

export function NoteEditor({ content, notePath, spellcheck, spellcheckLanguage, onChange }: NoteEditorProps) {
  const isProgrammaticUpdate = useRef(false)
  const [, setEditorVersion] = useState(0)

  const editor = useEditor({
    extensions: coreExtensions,
    content,
    editorProps: buildEditorProps(spellcheck, spellcheckLanguage),
    onUpdate({ editor }) {
      if (isProgrammaticUpdate.current) return
      onChange(getMarkdown(editor.storage))
    },
  })

  // ProseMirror re-applies editorProps.attributes to the DOM on every state
  // update, so setting the attribute by hand would be undone on the next
  // keystroke — the option itself has to change. setOptions rather than
  // useEditor deps, which would rebuild the editor and drop the cursor.
  useEffect(() => {
    editor?.setOptions({ editorProps: buildEditorProps(spellcheck, spellcheckLanguage) })
  }, [editor, spellcheck, spellcheckLanguage])

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

  // Recording on selectionUpdate rather than on unmount: the editor is already
  // destroyed by the time an unmount cleanup could read its state.
  useEffect(() => {
    if (!editor) return
    const onSelectionUpdate = () => {
      setEditorVersion((version) => version + 1)
      rememberPosition(notePath, { selection: editor.state.selection.anchor })
    }
    editor.on('selectionUpdate', onSelectionUpdate)

    return () => {
      editor.off('selectionUpdate', onSelectionUpdate)
    }
  }, [editor, notePath])

  // Runs once per note. The remembered offset came from a document that may
  // since have changed on disk, so TextSelection.near resolves to the closest
  // valid place instead of throwing on a position that is no longer a
  // text position.
  const restoredFor = useRef<string | null>(null)
  useEffect(() => {
    if (!editor || restoredFor.current === notePath) return
    restoredFor.current = notePath
    const remembered = recallPosition(notePath)
    if (!remembered) return

    editor.commands.command(({ tr, dispatch }) => {
      const position = Math.min(remembered.selection, tr.doc.content.size)
      dispatch?.(tr.setSelection(TextSelection.near(tr.doc.resolve(position))))
      return true
    })
    // scrollIntoView off: focus() otherwise scrolls the cursor into view from
    // inside a rAF, landing after the scroll restore and overriding it. When
    // the two disagree, what the user was looking at wins over where the
    // cursor happened to be.
    editor.commands.focus(null, { scrollIntoView: false })
  }, [editor, notePath, content])

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

  // Lets the native menu's "Insert Ink Block" item (and its accelerator)
  // reach the currently-focused note without lifting the editor instance
  // up to Layout — Layout just dispatches a plain window event.
  useEffect(() => {
    function onInsertInk() {
      void insertInkBlock()
    }
    window.addEventListener('command:insert-ink', onInsertInk)
    return () => window.removeEventListener('command:insert-ink', onInsertInk)
  }, [editor, notePath])

  // Same shape, for "Split Into Tasks". Confirmed before it runs: this
  // rewrites the whole note, and asserting that a document *is* an exercise
  // sheet is a claim only the reader can make — which is why no import path
  // does it automatically.
  useEffect(() => {
    async function onSplitTasks() {
      if (!editor) return
      if (!confirm('Rewrite this note into Task / Solution sections, each with a handwriting canvas?')) return
      if ((await splitIntoTasks(editor)) === 'no-structure') {
        alert('No exercise structure found in this note — nothing was changed.')
        return
      }
      onChange(getMarkdown(editor.storage))
    }
    // Named, so the removal targets the same function the addition registered.
    const handler = () => void onSplitTasks()
    window.addEventListener('command:split-tasks', handler)
    return () => window.removeEventListener('command:split-tasks', handler)
  }, [editor, onChange])

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
      {editor && <BlockHandle editor={editor} />}
      {editor && <EditorStatusBar editor={editor} />}
    </div>
  )
}
