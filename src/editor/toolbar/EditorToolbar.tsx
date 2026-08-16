import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { useInkStore } from '../../store/ink'
import { InkToolGroup } from './InkToolGroup'
import { TextFormatGroup } from './TextFormatGroup'
import { InsertGroup } from './InsertGroup'
import { SheetGroup } from './SheetGroup'
import { inkApi } from '../../lib/ink'
import type { InkData } from '../../ink/types'

interface EditorToolbarProps {
  editor: Editor | null
  notePath: string
}

// Sized to the editor pane's content width (800px max-width less 48px padding
// a side) so the right edge is not clipped, and tall enough for a worked
// derivation rather than a couple of lines.
const INK_WIDTH = 700
const INK_HEIGHT = 900

const EMPTY_INK: InkData = { width: INK_WIDTH, height: INK_HEIGHT, strokes: [], shapes: [] }

// One bar, one group at a time. A canvas being active means a pen is in hand,
// and then nothing else in the bar is what you want — so the ink group takes
// it alone rather than sharing a row it could not fit in anyway.
export function EditorToolbar({ editor, notePath }: EditorToolbarProps) {
  const drawing = useInkStore((s) => s.activeCanvas) !== null
  // Forces a re-render after a command run directly from this bar (the
  // language select) mutates the editor: `editor` is a mutable object, so
  // changing its state alone does not make this component re-render.
  const [, bump] = useState(0)

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

  const codeLanguage = editor?.getAttributes('codeBlock')['language']
  const selectedCodeLanguage = typeof codeLanguage === 'string' ? codeLanguage : ''

  return (
    <div
      className="editor-toolbar"
      role="toolbar"
      aria-label="Editor"
      // Never let a press move focus or the selection: clicking undo would
      // otherwise clear the very canvas undo is meant to act on.
      onMouseDown={(e) => e.preventDefault()}
    >
      {drawing ? (
        <InkToolGroup />
      ) : (
        <>
          {editor && <InsertGroup editor={editor} notePath={notePath} />}
          {editor && <SheetGroup editor={editor} />}
          {editor && (editor.isActive('codeBlock') ? (
            <label className="code-language-control">
              <span>Language</span>
              <select
                aria-label="Code block language"
                value={selectedCodeLanguage}
                onChange={(event) => {
                  editor.chain().focus().updateAttributes('codeBlock', { language: event.target.value }).run()
                  bump((n) => n + 1)
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
          ) : (
            <TextFormatGroup editor={editor} />
          ))}
        </>
      )}
    </div>
  )
}
