import { useEffect } from 'react'
import { useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { useInkStore } from '../../store/ink'
import { InkToolGroup } from './InkToolGroup'
import { TextFormatGroup } from './TextFormatGroup'
import { InsertGroup } from './InsertGroup'
import { SheetGroup } from './SheetGroup'
import { insertInk } from './insertInk'
import { report } from '../splitIntoTasks'

interface EditorToolbarProps {
  editor: Editor | null
  notePath: string
}

interface CodeBlockState {
  active: boolean
  language: string
}

const NO_CODE_BLOCK: CodeBlockState = { active: false, language: '' }

// One bar, one group at a time. A canvas being active means a pen is in hand,
// and then nothing else in the bar is what you want — so the ink group takes
// it alone rather than sharing a row it could not fit in anyway.
export function EditorToolbar({ editor, notePath }: EditorToolbarProps) {
  const drawing = useInkStore((s) => s.activeCanvas !== null)

  // Subscribed directly to the editor's own `transaction` event rather than
  // to a re-render forced by a parent: `setCodeBlock()` and
  // `updateAttributes('codeBlock', …)` both mutate the doc without moving the
  // selection, so `selectionUpdate` (what NoteEditor re-renders on) never
  // fires for either. This is what lets the bar switch to the language
  // select immediately after "Insert code block", and what lets the select
  // itself pick up its own `updateAttributes` call without the old `bump`
  // hack.
  const codeBlockState = useEditorState({
    editor,
    selector: ({ editor }) => {
      if (!editor) return NO_CODE_BLOCK
      const language = editor.getAttributes('codeBlock')['language']
      return { active: editor.isActive('codeBlock'), language: typeof language === 'string' ? language : '' }
    },
  }) ?? NO_CODE_BLOCK

  // Lets the native menu's "Insert Ink Block" item (and its accelerator)
  // reach the currently-focused note without lifting the editor instance
  // up to Layout — Layout just dispatches a plain window event.
  useEffect(() => {
    function onInsertInk() {
      if (!editor) return
      void insertInk(editor, notePath).catch(report)
    }
    window.addEventListener('command:insert-ink', onInsertInk)
    return () => window.removeEventListener('command:insert-ink', onInsertInk)
  }, [editor, notePath])

  return (
    <div
      className="editor-toolbar"
      role="toolbar"
      aria-label="Editor"
      // Never let a *button* press move focus or the selection: clicking undo
      // would otherwise clear the very canvas undo is meant to act on. Scoped
      // away from inputs and selects — the eraser/pen-size sliders need their
      // native mousedown to drag the thumb at all, and Chromium/WebView2 opens
      // a <select>'s dropdown as that same event's default action.
      onMouseDown={(event) => {
        if (!(event.target as HTMLElement).closest('input, select')) event.preventDefault()
      }}
    >
      {drawing ? (
        <InkToolGroup />
      ) : (
        <>
          {editor && <InsertGroup editor={editor} notePath={notePath} />}
          {editor && <span className="toolbar-sep" aria-hidden />}
          {editor && <SheetGroup editor={editor} />}
          {editor && <span className="toolbar-sep" aria-hidden />}
          {editor && (codeBlockState.active ? (
            <label className="code-language-control">
              <span>Language</span>
              <select
                aria-label="Code block language"
                value={codeBlockState.language}
                onChange={(event) => {
                  editor.chain().focus().updateAttributes('codeBlock', { language: event.target.value }).run()
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
