import { Extension } from '@tiptap/core'
import type { Editor, Range } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { createPortal } from 'react-dom'
import { message } from '@tauri-apps/plugin-dialog'
import { inkApi } from '../../lib/ink'
import { nextTaskLabel } from '../../lib/taskScaffold'
import { nextFootnoteLabel } from '../../lib/footnotes'
import { splitIntoTasks, addNextTask, report, markdownOf } from '../splitIntoTasks'
import { MERMAID_TEMPLATES } from '../../lib/mermaidTemplates'
import type { InkData } from '../../ink/types'

const INK_WIDTH = 700
const INK_HEIGHT = 900

const EMPTY_INK: InkData = { width: INK_WIDTH, height: INK_HEIGHT, strokes: [], shapes: [], texts: [] }

interface Cmd {
  title: string
  description: string
  aliases?: string[]
  run: (params: { editor: Editor; range: Range }) => void
}

interface CalloutType {
  title: string
  description: string
  calloutType: string
  numbered?: boolean
}

function calloutCommand({ title, description, calloutType, numbered }: CalloutType): Cmd {
  return {
    title,
    description,
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'callout',
          attrs: numbered ? { calloutType, title: '', number: '' } : { calloutType, title: '' },
          content: [{ type: 'paragraph' }],
        })
        .run(),
  }
}

const CALLOUT_TYPES: CalloutType[] = [
  { title: 'Note', description: 'Info callout', calloutType: 'note' },
  { title: 'Warning', description: 'Warning callout', calloutType: 'warning' },
  { title: 'Tip', description: 'Tip callout', calloutType: 'tip' },
  { title: 'Danger', description: 'Danger callout', calloutType: 'danger' },
  { title: 'Theorem', description: 'Numbered theorem block', calloutType: 'theorem', numbered: true },
  { title: 'Lemma', description: 'Numbered lemma block', calloutType: 'lemma', numbered: true },
  { title: 'Corollary', description: 'Numbered corollary block', calloutType: 'corollary', numbered: true },
  { title: 'Proof', description: 'Proof block', calloutType: 'proof', numbered: true },
  { title: 'Definition', description: 'Numbered definition block', calloutType: 'definition', numbered: true },
  { title: 'Example', description: 'Numbered example block', calloutType: 'example', numbered: true },
]

const TRAILING_CALLOUT_TYPES: CalloutType[] = [
  { title: 'Info', description: 'Info callout', calloutType: 'info' },
  { title: 'Important', description: 'Important callout', calloutType: 'important' },
]

const COMMANDS: Cmd[] = [
  {
    title: 'Heading 1',
    description: 'Large section heading',
    aliases: ['h1'],
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run(),
  },
  {
    title: 'Heading 2',
    description: 'Medium section heading',
    aliases: ['h2'],
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run(),
  },
  {
    title: 'Heading 3',
    description: 'Small section heading',
    aliases: ['h3'],
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run(),
  },
  {
    title: 'Code Block',
    description: 'Syntax-highlighted code',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setCodeBlock().run(),
  },
  {
    title: 'Expected Output',
    description: 'Assert expected output of previous code block',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setCodeBlock({ language: 'expect' }).run(),
  },
  // P14-1/P14-2: one entry per named diagram type, each scaffolding a
  // starting point that renders correctly on insertion rather than an empty
  // fence — `MERMAID_TEMPLATES` is the editable table, this just wires each
  // row to the slash menu the same way `MATH_SNIPPETS` wires into `/`.
  ...MERMAID_TEMPLATES.map((template) => ({
    title: template.title,
    description: template.description,
    run: ({ editor, range }: { editor: Editor; range: Range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'mermaidBlock', attrs: { code: template.code } })
        .run(),
  })),
  ...CALLOUT_TYPES.map(calloutCommand),
  {
    title: 'Algorithm Block',
    description: 'Complexity / Pseudocode / Implementation / References',
    // Reuses the Callout node exactly like Theorem/Proof — no new node type.
    // The four slots are plain bold-labeled sections inside the blockquote,
    // so the block stays readable as ordinary Markdown in any other editor.
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'callout',
          attrs: { calloutType: 'algorithm', title: '', number: '' },
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Complexity:', marks: [{ type: 'bold' }] }] },
            { type: 'paragraph' },
            { type: 'paragraph', content: [{ type: 'text', text: 'Pseudocode:', marks: [{ type: 'bold' }] }] },
            { type: 'codeBlock' },
            { type: 'paragraph', content: [{ type: 'text', text: 'Implementation:', marks: [{ type: 'bold' }] }] },
            { type: 'codeBlock' },
            { type: 'paragraph', content: [{ type: 'text', text: 'References:', marks: [{ type: 'bold' }] }] },
            { type: 'paragraph' },
          ],
        })
        .run(),
  },
  {
    title: 'Collapsible Section',
    description: 'Toggle block — click the summary to expand or collapse',
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'details', attrs: { summary: '' }, content: [{ type: 'paragraph' }] })
        .run(),
  },
  {
    title: 'Task List',
    description: 'Checkable to-do list',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    title: 'Divider',
    description: 'Horizontal rule',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    title: 'Footnote',
    description: 'Numbered footnote reference, appended definition ready to write in',
    // Two chained transactions, not one: the reference is inserted at the
    // cursor, then the empty definition is appended at the *document's*
    // end — a position that only exists to compute once the reference's
    // own insertion (and the "/footnote" text it replaced) has actually
    // landed. Never auto-relocated afterward, matching P13-1's own
    // "round-trips byte-identical to hand-written GFM" DoD: wherever a
    // footnote definition ends up is where it stays.
    run: ({ editor, range }) => {
      const labels: string[] = []
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'footnoteReference' || node.type.name === 'footnoteDefinition') {
          labels.push(node.attrs['label'] as string)
        }
        return true
      })
      const label = nextFootnoteLabel(labels)

      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'footnoteReference', attrs: { label } })
        .run()

      const endPos = editor.state.doc.content.size
      editor.chain().insertContentAt(endPos, { type: 'footnoteDefinition', attrs: { label } }).run()

      // Word-processor-style: drop the cursor straight into the freshly
      // appended (empty) definition so it's ready to type immediately.
      const newEndPos = editor.state.doc.content.size
      editor.chain().focus().setTextSelection(newEndPos - 1).run()
    },
  },
  {
    title: 'Ink Block',
    description: 'Handwriting canvas',
    run: ({ editor, range }) => {
      const notePath = editor.storage.noteContext.notePath
      if (!notePath) return
      editor.chain().focus().deleteRange(range).run()
      void inkApi.ensureDir(notePath).then((dir) => {
        const sep = dir.includes('\\') ? '\\' : '/'
        const svgPath = `${dir}${sep}sketch-${Date.now()}.svg`
        return inkApi.write(svgPath, EMPTY_INK).then(() => {
          editor.commands.insertContent({ type: 'inkBlock', attrs: { src: svgPath, width: INK_WIDTH, height: INK_HEIGHT } })
        })
      })
    },
  },
  {
    title: 'Flashcard',
    description: 'Q&A, cloze, or multiple-choice review card',
    run: ({ editor, range }) => {
      editor.storage.noteContext.openFlashcardDialog?.(editor, range)
    },
  },
  {
    title: 'Diagram',
    description: 'Interactive boxes, arrows and connectors',
    run: ({ editor, range }) => {
      editor.storage.noteContext.openDiagramDialog?.(editor, range)
    },
  },
  {
    title: 'Inline Math',
    description: 'LaTeX math inside a line of text',
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'inlineMath', attrs: { latex: '' } })
        .run(),
  },
  {
    title: 'Block Math',
    description: 'LaTeX block equation',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).insertContent({ type: 'blockMath', attrs: { latex: '' } }).run(),
  },
  {
    title: 'Split Into Tasks',
    description: 'Rewrite this note as Task / Solution sections with a canvas each',
    // Never happens on its own. A PDF import produces a plain note, because
    // "this document is an exercise sheet" is a claim about the document that
    // only the reader can make — a lecture script is not one.
    run: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      void splitIntoTasks(editor)
        .then((outcome) => {
          if (outcome === 'no-structure') {
            void message('No exercise structure found in this note — nothing was changed.')
          }
        })
        .catch(report)
    },
  },
  {
    title: 'Add Next Task',
    description: 'Append the next numbered Task and Solution pair, ready to write in',
    // Appended at the end of the note rather than at the cursor: the point is
    // that room for one more exercise is never something to plan in advance,
    // and the next task belongs after the last one wherever you happen to be.
    // Built as nodes rather than Markdown so the heading text is exactly what
    // `nextTaskLabel` will read back on the following invocation.
    run: ({ editor, range }) => {
      const label = nextTaskLabel(markdownOf(editor))
      editor.chain().focus().deleteRange(range).run()
      void addNextTask(editor, label).catch(report)
    },
  },
  {
    title: 'Table',
    description: '3×3 table with header row',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  ...TRAILING_CALLOUT_TYPES.map(calloutCommand),
]

// ── Menu component ────────────────────────────────────────────────────────────

interface MenuProps {
  items: Cmd[]
  onSelect: (cmd: Cmd) => void
  clientRect: (() => DOMRect | null) | null
}

interface MenuHandle {
  onKeyDown: (e: KeyboardEvent) => boolean
}

const SlashMenu = forwardRef<MenuHandle, MenuProps>(function SlashMenu(
  { items, onSelect, clientRect },
  ref,
) {
  const [selected, setSelected] = useState(0)

  useEffect(() => setSelected(0), [items])

  useImperativeHandle(ref, () => ({
    onKeyDown(e) {
      if (e.key === 'ArrowUp') {
        setSelected((s) => Math.max(0, s - 1))
        return true
      }
      if (e.key === 'ArrowDown') {
        setSelected((s) => Math.min(items.length - 1, s + 1))
        return true
      }
      if (e.key === 'Enter') {
        const item = items[selected]
        if (item) onSelect(item)
        return true
      }
      return false
    },
  }))

  const rect = clientRect?.()
  if (!items.length || !rect) return null

  return createPortal(
    <div
      className="slash-menu"
      style={{ position: 'fixed', top: rect.bottom + 6, left: rect.left, zIndex: 50 }}
    >
      {items.map((item, i) => (
        <button
          key={item.title}
          className={`slash-menu-item${i === selected ? ' selected' : ''}`}
          onMouseEnter={() => setSelected(i)}
          onMouseDown={(e) => {
            e.preventDefault()
            onSelect(item)
          }}
        >
          <span className="slash-item-title">{item.title}</span>
          <span className="slash-item-desc">{item.description}</span>
        </button>
      ))}
    </div>,
    document.body,
  )
})

// ── Extension ─────────────────────────────────────────────────────────────────

export const SlashCommands = Extension.create({
  name: 'slashCommands',

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: '/',
        allowSpaces: false,
        startOfLine: false,
        items({ query }: { query: string }) {
          const q = query.toLowerCase()
          return q
            ? COMMANDS.filter(
                (c) =>
                  c.title.toLowerCase().includes(q) ||
                  c.description.toLowerCase().includes(q) ||
                  c.aliases?.some((a) => a.includes(q)),
              )
            : COMMANDS
        },
        command({ editor, range, props }) {
          ;(props as Cmd).run({ editor, range })
        },
        render() {
          let renderer: ReactRenderer<MenuHandle, MenuProps>

          return {
            onStart(props) {
              renderer = new ReactRenderer(SlashMenu, {
                props: {
                  items: props.items as Cmd[],
                  onSelect: (cmd: Cmd) => props.command(cmd),
                  clientRect: props.clientRect,
                },
                editor: props.editor,
              })
            },
            onUpdate(props) {
              renderer.updateProps({
                items: props.items as Cmd[],
                onSelect: (cmd: Cmd) => props.command(cmd),
                clientRect: props.clientRect,
              })
            },
            onKeyDown({ event }) {
              if (event.key === 'Escape') {
                renderer.destroy()
                return true
              }
              return renderer.ref?.onKeyDown(event) ?? false
            },
            onExit() {
              renderer.destroy()
            },
          }
        },
      }),
    ]
  },
})
